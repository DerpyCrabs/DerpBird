#include <DerpBirdCredentialService.h>
#include <DerpBirdCredentialManager.h>
#include <DerpBirdCredentialProposal.h>
#include <QCoreApplication>
#include <QEventLoop>
#include <QTemporaryDir>
#include <cstdio>

using Service = Ladybird::DerpBirdCredentialService;
static ErrorOr<Service::Response> execute(Service& service, Service::Request request)
{
    QEventLoop loop;
    QTimer deadline; deadline.setSingleShot(true);
    QObject::connect(&deadline, &QTimer::timeout, &loop, &QEventLoop::quit);
    Optional<ErrorOr<Service::Response>> response;
    TRY(service.submit(move(request), [&](auto result) { response = move(result); loop.quit(); }));
    deadline.start(5000); loop.exec(); VERIFY(response.has_value());
    return response.release_value();
}
static void close(Service& service)
{
    QEventLoop loop;
    bool closed = false;
    MUST(service.close([&] { closed = true; loop.quit(); }));
    QTimer::singleShot(5000, &loop, &QEventLoop::quit);
    loop.exec(); VERIFY(closed && service.pending() == 0);
}
static Service::Request request(Service::Operation operation)
{
    return { operation, "https://example.com"_string, {}, {}, {}, 0 };
}
static Service::Request save(StringView password)
{
    auto result = request(Service::Operation::Save);
    result.username = "alice"_string;
    result.secret = Ladybird::DerpBirdSecret { secret_value_new(password.characters_without_null_termination(), password.length(), "application/octet-stream") };
    return result;
}
int main(int argc, char** argv)
{
    QCoreApplication app(argc, argv);
    {
        Ladybird::DerpBirdCredentialProposal proposal;
        size_t changes = 0;
        proposal.on_change = [&] { ++changes; };
        VERIFY(proposal.metadata().is_null());
        bool active = true;
        auto make = [&] { return proposal.propose("https://example.com"_string, "captured-user"_string, "captured-fixture"_string, [&] { return active; }); };
        auto metadata = MUST(make());
        VERIFY(metadata.as_object().size() == 3 && !metadata.as_object().has("password"sv));
        VERIFY(changes == 1);
        VERIFY(proposal.metadata().as_object().size() == 3);
        VERIFY(!proposal.metadata().as_object().has("password"sv));
        auto token = metadata.as_object().get_string("token"sv).release_value();
        auto next = MUST(make()).as_object().get_string("token"sv).release_value();
        VERIFY(next != token);
        VERIFY(proposal.take(token, ""_string, "0"_string).is_error());
        auto payload = MUST(proposal.take(next, ""_string, "0"_string));
        VERIFY(payload.as_object().get_string("password"sv) == "captured-fixture"sv);
        VERIFY(payload.as_object().get_string("username"sv) == "captured-user"sv);
        VERIFY(proposal.metadata().is_null());
        VERIFY(changes == 4); // initial, old cleared, replacement, consumed.
        VERIFY(proposal.take(next, ""_string, "0"_string).is_error());
        token = MUST(make()).as_object().get_string("token"sv).release_value();
        active = false;
        VERIFY(proposal.metadata().is_null());
        VERIFY(proposal.take(token, ""_string, "0"_string).is_error());
        active = true;
        VERIFY(proposal.take(token, ""_string, "0"_string).is_error());
        token = MUST(make()).as_object().get_string("token"sv).release_value();
        proposal.cancel("unrelated"_string);
        VERIFY(!proposal.take(token, "existing-id"_string, "9223372036854775807"_string).is_error());
        token = MUST(make()).as_object().get_string("token"sv).release_value();
        VERIFY(proposal.take(token, "existing-id"_string, "01"_string).is_error());
        VERIFY(proposal.take(token, "existing-id"_string, "1"_string).is_error());
        token = MUST(make()).as_object().get_string("token"sv).release_value();
        proposal.cancel(token);
        VERIFY(proposal.take(token, ""_string, "0"_string).is_error());
        Ladybird::DerpBirdCredentialProposal short_lived(10);
        size_t expiry_changes = 0;
        short_lived.on_change = [&] { ++expiry_changes; };
        token = MUST(short_lived.propose("https://example.com"_string, "user"_string, "fixture"_string, [] { return true; })).as_object().get_string("token"sv).release_value();
        QEventLoop expiry;
        QTimer::singleShot(40, &expiry, &QEventLoop::quit);
        expiry.exec();
        VERIFY(expiry_changes == 2); // Timer expiry must notify the shell without polling.
        VERIFY(short_lived.metadata().is_null());
        VERIFY(short_lived.take(token, ""_string, "0"_string).is_error());
        VERIFY(proposal.propose("https://example.com/path"_string, "user"_string, "fixture"_string, [] { return true; }).is_error());
        VERIFY(proposal.propose("https://example.com"_string, "user"_string, ""_string, [] { return true; }).is_error());
    }
    QTemporaryDir directory; VERIFY(directory.isValid());
    if (argc == 1) {
        {
            QFile csv(directory.path() + "/passwords.csv"); VERIFY(csv.open(QIODevice::WriteOnly));
            csv.write("name,url,username,password\nA,https://import.test/login,user,fixture-first\nB,https://import.test/other,user,do-not-replace\nC,https://second.test,other,fixture-second\nBad,android://invalid,user,skip\n"); csv.close();
            Service importer(directory.path() + "/import", "csv-import-fixture"_string);
            auto import_request = [&] { auto value = request(Service::Operation::ImportCsv); value.origin = {}; value.import_path = csv.fileName(); return value; };
            auto report = MUST(execute(importer, import_request())).get<JsonObject>();
            VERIFY(report.get_integer<size_t>("passwords"sv) == 2 && report.get_integer<size_t>("skipped"sv) == 2 && report.get_integer<size_t>("failed"sv) == 0);
            report = MUST(execute(importer, import_request())).get<JsonObject>();
            VERIFY(report.get_integer<size_t>("passwords"sv) == 0 && report.get_integer<size_t>("skipped"sv) == 4);
            auto list = request(Service::Operation::ListAll); list.origin = {};
            auto entries = MUST(execute(importer, move(list))).get<Vector<Service::Catalog::Entry>>();
            VERIFY(entries.size() == 2);
            for (auto const& entry : entries) {
                auto load = request(Service::Operation::Load); load.origin = entry.origin; load.id = entry.id;
                auto loaded = MUST(execute(importer, move(load)));
                auto& secret = loaded.get<Optional<Ladybird::DerpBirdSecret>>();
                VERIFY(secret.has_value());
                auto text = MUST(String::from_utf8(secret->bytes()));
                VERIFY(text == (entry.origin == "https://import.test"sv ? "fixture-first"sv : "fixture-second"sv));
            }
            close(importer);
        }

        Service accounts(directory.path() + "/accounts", "account-match-test"_string);
        MUST(execute(accounts, save("one"sv)));
        auto second = save("two"sv); second.username = "bob"_string;
        MUST(execute(accounts, move(second)));
        for (auto candidate : { "one"sv, "two"sv, "missing"sv }) {
            auto query = save(candidate); query.operation = Service::Operation::Matches;
            VERIFY(MUST(execute(accounts, move(query))).get<Service::MatchValue>().matches == (candidate == "one"sv));
        }
        auto bob = save("two"sv); bob.operation = Service::Operation::Matches; bob.username = "bob"_string;
        VERIFY(MUST(execute(accounts, move(bob))).get<Service::MatchValue>().matches);
        VERIFY(MUST(execute(accounts, request(Service::Operation::List))).get<Vector<Service::Catalog::Entry>>().size() == 2);
        close(accounts);
    }
    String id;
    i64 revision = 0;
    {
        Service service(directory.path(), "profile-service-test"_string);
        if (argc > 1) {
            VERIFY(execute(service, save("unavailable"sv)).is_error());
            VERIFY(MUST(execute(service, request(Service::Operation::List))).get<Vector<Service::Catalog::Entry>>().is_empty());
            close(service);
            return 0;
        }
        auto saved = MUST(execute(service, save("first\0binary"sv)));
        auto entry = saved.get<Service::Catalog::Entry>();
        id = entry.id; revision = entry.revision;
        auto matches = [&](StringView password, StringView username = "alice"sv, StringView origin = "https://example.com"sv) {
            auto query = save(password); query.operation = Service::Operation::Matches;
            query.username = MUST(String::from_utf8(username)); query.origin = MUST(String::from_utf8(origin));
            return MUST(execute(service, move(query))).get<Service::MatchValue>().matches;
        };
        VERIFY(matches("first\0binary"sv));
        VERIFY(!matches("first\0Binary"sv));
        VERIFY(!matches("first"sv));
        VERIFY(!matches("first\0binary"sv, "Alice"sv));
        VERIFY(!matches("first\0binary"sv, "alice"sv, "http://example.com"sv));
        auto malformed_match = save("first\0binary"sv); malformed_match.operation = Service::Operation::Matches; malformed_match.id = id;
        VERIFY(execute(service, move(malformed_match)).is_error());
        VERIFY(execute(service, request(Service::Operation::Matches)).is_error());
        {
            Service competing(directory.path(), "profile-service-test"_string);
            VERIFY(execute(competing, request(Service::Operation::List)).is_error());
            close(competing);
        }
        VERIFY(MUST(execute(service, request(Service::Operation::List))).get<Vector<Service::Catalog::Entry>>().size() == 1);
        auto load = request(Service::Operation::Load); load.id = id;
        VERIFY(MUST(execute(service, move(load))).get<Optional<Ladybird::DerpBirdSecret>>()->bytes() == "first\0binary"sv.bytes());
        load = request(Service::Operation::Load); load.id = id; load.origin = "http://example.com"_string;
        VERIFY(!MUST(execute(service, move(load))).get<Optional<Ladybird::DerpBirdSecret>>().has_value());
        auto invalid = request(Service::Operation::List); invalid.origin = "https://example.com/path"_string;
        VERIFY(execute(service, move(invalid)).is_error());
        MUST(execute(service, request(Service::Operation::BlockOrigin)));
        close(service);
        VERIFY(service.submit(request(Service::Operation::List), [](auto) { VERIFY_NOT_REACHED(); }).is_error());
    }
    {
        Service reopened(directory.path(), "profile-service-test"_string);
        auto exceptions = request(Service::Operation::ListExceptions); exceptions.origin = {};
        VERIFY(MUST(execute(reopened, move(exceptions))).get<Vector<String>>().size() == 1);
        auto blocked_query = save("unrelated"sv); blocked_query.operation = Service::Operation::Matches;
        VERIFY(MUST(execute(reopened, move(blocked_query))).get<Service::MatchValue>().blocked);
        MUST(execute(reopened, request(Service::Operation::AllowOrigin)));
        auto load = request(Service::Operation::Load); load.id = id;
        VERIFY(MUST(execute(reopened, move(load))).get<Optional<Ladybird::DerpBirdSecret>>()->bytes() == "first\0binary"sv.bytes());
        auto update = save("second"sv); update.id = id; update.revision = revision;
        auto saved = MUST(execute(reopened, move(update)));
        revision = saved.get<Service::Catalog::Entry>().revision;
        auto same = save("second"sv); same.operation = Service::Operation::Matches;
        VERIFY(MUST(execute(reopened, move(same))).get<Service::MatchValue>().matches);
        auto old = save("first\0binary"sv); old.operation = Service::Operation::Matches;
        VERIFY(!MUST(execute(reopened, move(old))).get<Service::MatchValue>().matches);
        auto cleanup = request(Service::Operation::Cleanup); cleanup.origin = {};
        VERIFY(MUST(execute(reopened, move(cleanup))).get<size_t>() == 1);
        auto remove = request(Service::Operation::Remove); remove.id = id; remove.revision = revision;
        MUST(execute(reopened, move(remove)));
        cleanup = request(Service::Operation::Cleanup); cleanup.origin = {};
        VERIFY(MUST(execute(reopened, move(cleanup))).get<size_t>() == 1);
        VERIFY(MUST(execute(reopened, request(Service::Operation::List))).get<Vector<Service::Catalog::Entry>>().is_empty());
        close(reopened);
    }
    {
        Ladybird::DerpBirdCredentialManager manager(directory.path() + "/manager", "manager-test"_string);
        auto dispatch = [&](JsonValue payload, bool is_private = false) -> ErrorOr<JsonValue> {
            QEventLoop loop;
            Optional<ErrorOr<JsonValue>> result;
            Ladybird::DerpBirdCredentialManager::Completion done = [&](auto value) { result = move(value); loop.quit(); };
            auto admitted = manager.dispatch(payload, is_private, done);
            if (admitted.is_error()) { VERIFY(done); return admitted.release_error(); }
            VERIFY(!done);
            QTimer::singleShot(5000, &loop, &QEventLoop::quit);
            loop.exec(); VERIFY(result.has_value());
            return result.release_value();
        };
        auto list = MUST(JsonValue::from_string(R"({"type":"credentials.list"})"sv));
        VERIFY(dispatch(list, true).is_error());
        VERIFY(MUST(dispatch(list)).as_object().get_array("items"sv)->is_empty());
        Ladybird::DerpBirdCredentialProposal proposal;
        auto captured = MUST(proposal.propose("https://example.com"_string, "captured-user"_string, "captured-fixture"_string, [] { return true; }));
        auto captured_payload = MUST(proposal.take(captured.as_object().get_string("token"sv).value(), ""_string, "0"_string));
        VERIFY(dispatch(captured_payload, true).is_error());
        auto captured_entry = MUST(dispatch(captured_payload));
        auto policy = MUST(JsonValue::from_string(R"({"type":"credentials.block-origin","origin":"https://example.com","id":"","revision":"0"})"sv));
        VERIFY(dispatch(policy, true).is_error());
        VERIFY(MUST(dispatch(policy)).as_object().get_array("origins"sv)->size() == 1);
        auto blocked_check = captured_payload; blocked_check.as_object().set("type"sv, "credentials.matches"sv);
        VERIFY(MUST(dispatch(blocked_check)).as_object().get_bool("blocked"sv).value());
        policy.as_object().set("type"sv, "credentials.allow-origin"sv);
        VERIFY(MUST(dispatch(policy)).as_object().get_array("origins"sv)->is_empty());
        auto comparison = captured_payload;
        comparison.as_object().set("type"sv, "credentials.matches"sv);
        VERIFY(dispatch(comparison, true).is_error());
        auto matching = MUST(dispatch(comparison));
        VERIFY(matching.as_object().size() == 2 && matching.as_object().get_bool("matches"sv).value());
        comparison.as_object().set("password"sv, "changed-fixture"sv);
        VERIFY(!MUST(dispatch(comparison)).as_object().get_bool("matches"sv).value());
        captured_entry.as_object().set("type"sv, "credentials.reveal"sv);
        VERIFY(MUST(dispatch(captured_entry)).as_object().get_string("password"sv) == "captured-fixture"sv);
        captured_entry.as_object().set("type"sv, "credentials.remove"sv);
        MUST(dispatch(captured_entry));
        auto save = MUST(JsonValue::from_string(R"({"type":"credentials.save","id":"","revision":"0","origin":"https://example.com","username":"alice","password":"fixture-only"})"sv));
        auto entry = MUST(dispatch(save));
        VERIFY(!entry.as_object().has("secret_id"sv) && !entry.as_object().has("password"sv));
        auto items = MUST(dispatch(list)).as_object().get_array("items"sv).release_value();
        VERIFY(items.size() == 1);
        auto& data = save.as_object();
        data.set("id"sv, *entry.as_object().get_string("id"sv));
        data.set("revision"sv, *entry.as_object().get_string("revision"sv));
        auto reveal = entry;
        reveal.as_object().set("type"sv, "credentials.reveal"sv);
        VERIFY(*MUST(dispatch(reveal)).as_object().get_string("password"sv) == "fixture-only"sv);
        VERIFY(dispatch(reveal, true).is_error());
        auto fill = reveal;
        fill.as_object().set("type"sv, "credentials.for-fill"sv);
        auto fill_value = MUST(dispatch(fill));
        VERIFY(fill_value.as_object().get_string("username"sv) == entry.as_object().get_string("username"sv));
        VERIFY(fill_value.as_object().get_string("password"sv) == "fixture-only"sv);
        VERIFY(dispatch(fill, true).is_error());

        auto wrong_origin = reveal;
        wrong_origin.as_object().set("origin"sv, "http://example.com"sv);
        VERIFY(dispatch(wrong_origin).is_error());
        auto updated = MUST(dispatch(save));
        VERIFY(dispatch(reveal).is_error());
        VERIFY(dispatch(fill).is_error());
        reveal.as_object().set("revision"sv, *updated.as_object().get_string("revision"sv));
        VERIFY(*MUST(dispatch(reveal)).as_object().get_string("password"sv) == "fixture-only"sv);
        VERIFY(dispatch(save).is_error());
        data.set("revision"sv, "01"sv);
        VERIFY(dispatch(save).is_error());
        data.set("revision"sv, *updated.as_object().get_string("revision"sv));
        data.set("type"sv, "credentials.remove"sv);
        MUST(dispatch(save));
        VERIFY(MUST(dispatch(list)).as_object().get_array("items"sv)->is_empty());
        QEventLoop loop;
        bool closed = false;
        MUST(manager.close([&] { closed = true; loop.quit(); }));
        QTimer::singleShot(5000, &loop, &QEventLoop::quit);
        loop.exec(); VERIFY(closed);
    }
    std::puts("Async profile credentials save/load/reopen/update/delete and cleanup passed");
}
