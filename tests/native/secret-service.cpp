#include <DerpBirdSecretService.h>
#include <QCoreApplication>
#include <QEventLoop>
#include <atomic>
#include <cstdio>

using Service = Ladybird::DerpBirdSecretService;
static Service::Request request(Service::Operation operation = Service::Operation::Remove)
{
    return { operation, "test-profile"_string, "credential"_string, {} };
}
static void wait_for(Function<bool()> ready)
{
    QEventLoop loop;
    QTimer poll, deadline;
    poll.setInterval(1);
    deadline.setSingleShot(true);
    bool expired = false;
    QObject::connect(&poll, &QTimer::timeout, &loop, [&] { if (ready()) loop.quit(); });
    QObject::connect(&deadline, &QTimer::timeout, &loop, [&] { expired = true; loop.quit(); });
    poll.start(); deadline.start(3000);
    if (!ready()) loop.exec();
    VERIFY(!expired && ready());
}
int main(int argc, char** argv)
{
    QCoreApplication app(argc, argv);
    {
        std::atomic<bool> release { false };
        std::atomic<size_t> calls { 0 };
        Service service([&](auto const&, auto*) -> Service::Result {
            VERIFY(QThread::currentThread() != app.thread());
            ++calls;
            while (!release.load()) QThread::msleep(1);
            return Optional<Ladybird::DerpBirdSecret> {};
        }, 25);
        size_t replies = 0;
        Vector<u64> ids;
        for (size_t i = 0; i < Service::max_pending; ++i)
            ids.append(MUST(service.submit(request(), [&](auto result) {
                VERIFY(QThread::currentThread() == app.thread() && result.is_error()); ++replies;
            })));
        VERIFY(service.submit(request(), [](auto) { VERIFY_NOT_REACHED(); }).is_error());
        wait_for([&] { return replies == Service::max_pending; });
        VERIFY(service.pending() == Service::max_pending && service.bytes() > 0);
        VERIFY(service.submit(request(), [](auto) { VERIFY_NOT_REACHED(); }).is_error());
        VERIFY(!service.cancel(ids[0]));
        release = true;
        wait_for([&] { return service.pending() == 0; });
        VERIFY(calls == 1 && service.bytes() == 0 && replies == Service::max_pending);
        bool done = false;
        MUST(service.submit(request(), [&](auto result) { VERIFY(!result.is_error()); done = true; }));
        wait_for([&] { return done; });
        bool closed = false;
        MUST(service.close([&] { closed = true; }));
        VERIFY(service.submit(request(), [](auto) { VERIFY_NOT_REACHED(); }).is_error());
        wait_for([&] { return closed; });
    }
    {
        std::atomic<bool> started { false };
        Service service([&](auto const&, GCancellable* cancel) -> Service::Result {
            started = true;
            while (!g_cancellable_is_cancelled(cancel)) QThread::msleep(1);
            return Error::from_string_literal("cancelled provider");
        });
        size_t replies = 0;
        for (size_t i = 0; i < 3; ++i)
            MUST(service.submit(request(), [&](auto result) { VERIFY(result.is_error()); ++replies; }));
        wait_for([&] { return started.load(); });
        bool closed = false;
        MUST(service.close([&] { VERIFY(service.pending() == 0); closed = true; }));
        VERIFY(replies == 3);
        wait_for([&] { return closed; });
        VERIFY(replies == 3);
    }
    {
        std::atomic<bool> release { false };
        Service service([&](auto const&, auto*) -> Service::Result {
            while (!release.load()) QThread::msleep(1);
            return Optional<Ladybird::DerpBirdSecret> {};
        });
        size_t admitted = 0, replies = 0;
        for (;;) {
            auto accepted = service.submit(request(Service::Operation::Get), [&](auto result) { VERIFY(!result.is_error()); ++replies; });
            if (accepted.is_error()) break;
            ++admitted;
        }
        VERIFY(admitted == Service::max_bytes / (256 + Ladybird::DerpBirdSecretStore::max_secret_bytes));
        VERIFY(service.bytes() <= Service::max_bytes && admitted < Service::max_pending);
        release = true;
        wait_for([&] { return replies == admitted; });
    }
    {
        std::atomic<bool> started { false };
        auto service = std::make_unique<Service>([&](auto const&, GCancellable* cancel) -> Service::Result {
            started = true;
            while (!g_cancellable_is_cancelled(cancel)) QThread::msleep(1);
            return Error::from_string_literal("cancelled provider");
        });
        size_t replies = 0;
        auto id = MUST(service->submit(request(), [&](auto result) {
            VERIFY(result.is_error()); ++replies; service.reset();
        }));
        wait_for([&] { return started.load(); });
        VERIFY(service->cancel(id));
        VERIFY(!service && replies == 1);
        QCoreApplication::processEvents();
        VERIFY(replies == 1);
    }
    std::puts("Secret worker affinity, count/byte limits, deadlines, cancellation and shutdown passed");
}
