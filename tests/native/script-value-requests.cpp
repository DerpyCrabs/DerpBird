#include <DerpBirdValueRequests.h>
#include <LibCore/EventLoop.h>
#include <cstdio>

int main()
{
    Core::EventLoop loop;
    auto requests = Web::DerpBirdValueRequests::create();
    Web::PageId page { 1 };
    Web::HTML::CrossProcessId document { 4, 5 };
    int replies = 0;
    auto id = MUST(requests->add(page, document, [&](auto result) {
        VERIFY(!result.is_error() && StringView(result.value().bytes()) == "answer"sv);
        ++replies;
    }));
    requests->complete(Web::PageId { 2 }, document, id, {}, {});
    requests->complete(page, { 6, 5 }, id, {}, {});
    requests->complete(page, document, id + 1, {}, {});
    VERIFY(requests->pending() == 1 && replies == 0);
    requests->complete(page, document, id, MUST(ByteBuffer::copy("answer"sv.bytes())), {});
    requests->complete(page, document, id, {}, {});
    VERIFY(requests->pending() == 0 && replies == 1);
    auto cancelled = MUST(requests->add(page, document, [](auto) { VERIFY_NOT_REACHED(); }));
    requests->cancel_document(page, { 7, 5 });
    VERIFY(requests->pending() == 1);
    requests->cancel_document(page, document);
    requests->complete(page, document, cancelled, {}, {});
    VERIFY(requests->pending() == 0);
    for (int i = 0; i < 128; ++i)
        MUST(requests->add(page, document, [](auto) { VERIFY_NOT_REACHED(); }));
    VERIFY(requests->add(page, document, [](auto) { VERIFY_NOT_REACHED(); }).is_error());
    requests->cancel_page(page);
    VERIFY(requests->pending() == 0);
    auto rejected = MUST(requests->add(page, document, [&](auto result) { VERIFY(result.is_error()); ++replies; }));
    requests->complete(page, document, rejected, {}, "Denied"_string);
    VERIFY(replies == 2);
    auto large = MUST(requests->add(page, document, [&](auto result) { VERIFY(result.is_error()); ++replies; }));
    requests->complete(page, document, large, MUST(ByteBuffer::create_uninitialized(Web::DerpBirdValueRequests::max_payload_bytes + 1)), {});
    VERIFY(replies == 3);
    bool expired = false;
    bool watchdog = false;
    auto timer = Core::Timer::create_single_shot(AK::Duration::from_seconds(35), [&] { watchdog = true; });
    timer->start();
    MUST(requests->add(page, document, [&](auto result) { VERIFY(result.is_error()); expired = true; }));
    loop.spin_until([&] { return expired || watchdog; });
    VERIFY(expired && !watchdog && requests->pending() == 0);
    std::puts("Userscript request correlation, cancellation, limits and timeout passed");
}
