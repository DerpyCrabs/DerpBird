#include <DerpBirdSecretService.h>
#include <QCoreApplication>
#include <QEventLoop>
#include <cstdio>

using Service = Ladybird::DerpBirdSecretService;
static Service::Result execute(Service& service, Service::Request request)
{
    QEventLoop loop;
    QTimer deadline;
    deadline.setSingleShot(true);
    QObject::connect(&deadline, &QTimer::timeout, &loop, &QEventLoop::quit);
    Optional<Service::Result> result;
    TRY(service.submit(move(request), [&](auto reply) { result = move(reply); loop.quit(); }));
    deadline.start(5000); loop.exec();
    VERIFY(result.has_value());
    return result.release_value();
}
int main(int argc, char** argv)
{
    QCoreApplication app(argc, argv);
    Service service;
    auto request = [](Service::Operation operation) { return Service::Request { operation, "worker-profile"_string, "worker-credential"_string, {} }; };
    if (argc > 1) {
        VERIFY(execute(service, request(Service::Operation::Get)).is_error());
    } else {
        MUST(execute(service, request(Service::Operation::Remove)));
        VERIFY(!MUST(execute(service, request(Service::Operation::Get))).has_value());
        auto put = request(Service::Operation::Put);
        auto data = "worker\0binary\xff"sv;
        put.secret = Ladybird::DerpBirdSecret { secret_value_new(data.characters_without_null_termination(), data.length(), "application/octet-stream") };
        MUST(execute(service, move(put)));
        auto result = MUST(execute(service, request(Service::Operation::Get)));
        VERIFY(result.has_value() && StringView(result->bytes()) == data);
        MUST(execute(service, request(Service::Operation::Remove)));
        VERIFY(!MUST(execute(service, request(Service::Operation::Get))).has_value());
    }
    QEventLoop loop;
    bool closed = false;
    MUST(service.close([&] { closed = true; loop.quit(); }));
    QTimer::singleShot(5000, &loop, &QEventLoop::quit);
    loop.exec(); VERIFY(closed);
    std::puts("Real platform secret operations complete on worker and shut down cleanly");
}
