#include <DerpBirdValueService.h>
#include <QCoreApplication>
#include <QElapsedTimer>
#include <QEventLoop>
#include <QTemporaryDir>
#include <QTimer>
#include <cstdio>

using Service = Ladybird::DerpBirdValueService;
static ErrorOr<Service::Response> request(Service& service, Service::Request request)
{
    QEventLoop loop;
    QTimer deadline;
    deadline.setSingleShot(true);
    QObject::connect(&deadline, &QTimer::timeout, &loop, &QEventLoop::quit);
    Optional<ErrorOr<Service::Response>> result;
    bool returned = false;
    TRY(service.submit(move(request), [&](auto response) {
        VERIFY(returned && QThread::currentThread() == QCoreApplication::instance()->thread());
        result = move(response);
        loop.quit();
    }));
    returned = true;
    deadline.start(5000);
    loop.exec();
    VERIFY(result.has_value());
    return result.release_value();
}
static Service::Request write(StringView payload)
{
    Service::Request request { Service::Operation::Apply, "script"_string, {}, {}, {} };
    request.updates.append({ "value"_string, MUST(ByteBuffer::copy(payload.bytes())) });
    return request;
}
static void close(Service& service)
{
    QEventLoop loop;
    QTimer deadline;
    deadline.setSingleShot(true);
    QObject::connect(&deadline, &QTimer::timeout, &loop, &QEventLoop::quit);
    bool closed = false;
    MUST(service.close([&] { closed = true; loop.quit(); }));
    VERIFY(service.submit(write("rejected"sv), [](auto) { VERIFY_NOT_REACHED(); }).is_error());
    deadline.start(5000);
    loop.exec();
    VERIFY(closed && service.pending() == 0);
}
int main(int argc, char** argv)
{
    QCoreApplication app(argc, argv);
    QTemporaryDir temporary;
    VERIFY(temporary.isValid());
    auto directory = temporary.path() + "/persistent";
    {
        Service service(directory, false);
        auto result = MUST(request(service, write("persisted"sv)));
        VERIFY(result.get<i64>() == 1);
        QFile database_file(directory + "/Values.db");
        VERIFY(!(database_file.permissions() & (QFileDevice::ReadGroup | QFileDevice::ReadOther | QFileDevice::WriteGroup | QFileDevice::WriteOther)));
        auto path = directory.toUtf8();
        auto locked = MUST(Database::Database::create(ByteString(path.constData()), "Values"sv));
        MUST(locked->execute_raw("BEGIN IMMEDIATE"));
        int heartbeats = 0;
        QTimer heartbeat;
        heartbeat.setInterval(5);
        QObject::connect(&heartbeat, &QTimer::timeout, [&] { ++heartbeats; });
        heartbeat.start();
        QElapsedTimer elapsed;
        elapsed.start();
        VERIFY(request(service, write("blocked"sv)).is_error());
        auto lock_wait = elapsed.elapsed();
        heartbeat.stop();
        VERIFY(lock_wait >= 150 && heartbeats >= 5);
        std::printf("Writer lock waited %lld ms on worker; UI event loop delivered %d timer ticks\n", static_cast<long long>(lock_wait), heartbeats);
        MUST(locked->execute_raw("ROLLBACK"));
        auto stored = MUST(request(service, { Service::Operation::Get, "script"_string, "value"_string, {}, {} }));
        VERIFY(StringView(stored.get<Optional<ByteBuffer>>()->bytes()) == "persisted"sv);
        close(service);
    }
    {
        Service reopened(directory, false);
        auto result = MUST(request(reopened, { Service::Operation::Get, "script"_string, "value"_string, {}, {} }));
        VERIFY(StringView(result.get<Optional<ByteBuffer>>()->bytes()) == "persisted"sv);
        // Completion order and close-after-drain follow accepted request order.
        QEventLoop loop;
        QTimer deadline;
        deadline.setSingleShot(true);
        QObject::connect(&deadline, &QTimer::timeout, &loop, &QEventLoop::quit);
        int replies = 0;
        MUST(reopened.submit(write("queued-one"sv), [&](auto result) { VERIFY(!result.is_error() && replies++ == 0); }));
        MUST(reopened.submit(write("queued-two"sv), [&](auto result) { VERIFY(!result.is_error() && replies++ == 1); }));
        bool done = false;
        MUST(reopened.close([&] { VERIFY(replies == 2); done = true; loop.quit(); }));
        deadline.start(5000); loop.exec(); VERIFY(done);
    }
    {
        // Destructor fallback persists accepted work without running callbacks
        // into destroyed receiver objects.
        Service transient(directory, false);
        transient.set_change_callback([](auto const&, auto const&, auto const&, u64) { VERIFY_NOT_REACHED(); });
        for (int i = 0; i < 128; ++i)
            MUST(transient.submit(write("destructor-drain"sv), [](auto) { VERIFY_NOT_REACHED(); }));
    }
    {
        Service reopened(directory, false);
        auto result = MUST(request(reopened, { Service::Operation::Get, "script"_string, "value"_string, {}, {} }));
        VERIFY(StringView(result.get<Optional<ByteBuffer>>()->bytes()) == "destructor-drain"sv);
        close(reopened);
    }
    {
        auto private_path = temporary.path() + "/must-not-exist";
        Service private_service(private_path, true);
        MUST(request(private_service, write("private"sv)));
        VERIFY(!QFile::exists(private_path));
        close(private_service);
        Service fresh_private(private_path, true);
        auto result = MUST(request(fresh_private, { Service::Operation::Get, "script"_string, "value"_string, {}, {} }));
        VERIFY(!result.get<Optional<ByteBuffer>>().has_value());
        close(fresh_private);
    }
    {
        Service bounded({}, true);
        QEventLoop loop;
        QTimer deadline;
        deadline.setSingleShot(true);
        QObject::connect(&deadline, &QTimer::timeout, &loop, &QEventLoop::quit);
        int replies = 0;
        for (int i = 0; i < 128; ++i)
            MUST(bounded.submit({ Service::Operation::Snapshot, "script"_string, {}, {}, {} }, [&](auto result) { VERIFY(!result.is_error()); ++replies; }));
        VERIFY(bounded.submit({ Service::Operation::Snapshot, "script"_string, {}, {}, {} }, [](auto) { VERIFY_NOT_REACHED(); }).is_error());
        // Closing while requests wait must drain the entire accepted FIFO.
        bool drained = false;
        MUST(bounded.close([&] { drained = true; loop.quit(); }));
        deadline.start(5000); loop.exec();
        VERIFY(drained && replies == 128 && bounded.pending() == 0);
    }
    {
        Service observed({}, true);
        Vector<String> events;
        observed.set_change_callback([&](String const& scope, String const& origin, Service::Store::Commit const& commit, u64 sequence) {
            VERIFY(sequence > 0);
            VERIFY(QThread::currentThread() == app.thread());
            VERIFY(scope == "script"sv && origin == "writer-token"sv);
            VERIFY(commit.changes.size() == 1 && commit.changes[0].key == "value"sv);
            auto const& change = commit.changes[0];
            auto old_value = change.old_value.has_value() ? StringView(change.old_value->bytes()) : "absent"sv;
            auto new_value = change.new_value.has_value() ? StringView(change.new_value->bytes()) : "absent"sv;
            events.append(MUST(String::formatted("{}:{}:{}", commit.revision, old_value, new_value)));
        });
        auto first = write("a"sv); first.origin_token = "writer-token"_string;
        VERIFY(MUST(request(observed, move(first))).get<i64>() == 1);
        VERIFY(events.size() == 1 && events[0] == "1:absent:a"sv);
        auto noop = write("a"sv); noop.origin_token = "writer-token"_string;
        VERIFY(MUST(request(observed, move(noop))).get<i64>() == 2);
        VERIFY(events.size() == 1);
        auto second = write("b"sv); second.origin_token = "writer-token"_string;
        VERIFY(MUST(request(observed, move(second))).get<i64>() == 3);
        VERIFY(events.size() == 2 && events[1] == "3:a:b"sv);
        auto stale = write("stale"sv); stale.expected_revision = 1; stale.origin_token = "writer-token"_string;
        VERIFY(request(observed, move(stale)).is_error());
        VERIFY(events.size() == 2);
        Service::Request deletion { Service::Operation::Apply, "script"_string, {}, { { "value"_string, {} } }, {}, "writer-token"_string };
        VERIFY(MUST(request(observed, move(deletion))).get<i64>() == 4);
        VERIFY(events.size() == 3 && events[2] == "4:b:absent"sv);
        // Removing the delivery callback also removes old/new capture overhead.
        observed.set_change_callback({});
        MUST(request(observed, write("silent"sv)));
        VERIFY(events.size() == 3);
        int self_removed = 0;
        observed.set_change_callback([&](auto const&, auto const&, auto const&, u64) {
            observed.set_change_callback({});
            ++self_removed;
        });
        MUST(request(observed, write("self-remove"sv)));
        MUST(request(observed, write("after-remove"sv)));
        VERIFY(self_removed == 1);
        close(observed);
    }
    {
        Service bounded_events({}, true);
        bounded_events.set_change_callback([](auto const&, auto const&, auto const&, u64) { });
        QEventLoop loop;
        QTimer deadline;
        deadline.setSingleShot(true);
        QObject::connect(&deadline, &QTimer::timeout, &loop, &QEventLoop::quit);
        size_t accepted = 0, completed = 0;
        for (size_t i = 0; i < 128; ++i) {
            auto queued = bounded_events.submit(write("event"sv), [&](auto result) {
                VERIFY(!result.is_error());
                if (++completed == accepted) loop.quit();
            });
            if (queued.is_error()) break;
            ++accepted;
        }
        // Small requests wait for bounded reply capacity instead of failing.
        VERIFY(accepted == 128 && bounded_events.pending() == accepted);
        deadline.start(5000); loop.exec();
        VERIFY(completed == accepted);
        close(bounded_events);
    }
    {
        Service invalid("relative-path", false);
        VERIFY(request(invalid, write("no"sv)).is_error());
        VERIFY(request(invalid, write("still-no"sv)).is_error());
        close(invalid);
    }
    std::puts("Userscript value worker checks passed");
}
