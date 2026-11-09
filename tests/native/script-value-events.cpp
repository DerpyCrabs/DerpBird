#include <DerpBirdValueEvents.h>
#include <LibCore/EventLoop.h>
#include <cstdio>

using Events = WebView::DerpBirdValueEvents;
static ByteBuffer payload(size_t size = 16) { return MUST(ByteBuffer::create_zeroed(size)); }
int main()
{
    Core::EventLoop loop;
    Web::PageId page { 1 };
    Web::HTML::CrossProcessId document { 2, 3 };
    Vector<u64> sent;
    size_t replies = 0;
    auto events = Events::create([&](auto, auto, u64 id, ReadonlyBytes bytes) -> ErrorOr<void> {
        VERIFY(bytes.size() == 16); sent.append(id); return {};
    });
    Vector<u64> ids;
    for (size_t i = 0; i < 6; ++i)
        ids.append(MUST(events->enqueue(page, document, payload(), [&](auto result) { VERIFY(!result.is_error()); ++replies; })));
    VERIFY(sent.size() == 4 && events->pending() == 6 && events->inflight() == 4 && events->bytes() == 96);
    events->acknowledge(page, document, ids[4], true); // Unsent IDs cannot release credit.
    events->acknowledge(Web::PageId { 2 }, document, ids[0], true);
    events->acknowledge(page, { 3, 3 }, ids[0], true);
    VERIFY(replies == 0 && sent.size() == 4);
    events->acknowledge(page, document, ids[1], true);
    VERIFY(sent.size() == 5 && sent.last() == ids[4] && replies == 1);
    events->acknowledge(page, document, ids[1], true);
    VERIFY(replies == 1);
    for (auto id : ids) events->acknowledge(page, document, id, true);
    VERIFY(replies == 6 && events->pending() == 0 && events->inflight() == 0 && events->bytes() == 0);
    events->close();
    VERIFY(events->enqueue(page, document, payload(), [](auto) { VERIFY_NOT_REACHED(); }).is_error());
    {
        auto bounded = Events::create([](auto, auto, auto, auto) -> ErrorOr<void> { return {}; });
        size_t failed = 0;
        for (size_t i = 0; i < Events::max_pending; ++i)
            MUST(bounded->enqueue(page, document, payload(1), [&](auto result) { VERIFY(result.is_error()); ++failed; }));
        VERIFY(bounded->enqueue(page, document, payload(1), [](auto) { VERIFY_NOT_REACHED(); }).is_error());
        bounded->close(); VERIFY(failed == Events::max_pending && bounded->bytes() == 0);
    }
    {
        auto bounded = Events::create([](auto, auto, auto, auto) -> ErrorOr<void> { return {}; });
        size_t accepted = 0, failed = 0;
        for (;;) {
            auto queued = bounded->enqueue(page, document, payload(Events::max_payload), [&](auto result) { VERIFY(result.is_error()); ++failed; });
            if (queued.is_error()) break;
            ++accepted;
        }
        VERIFY(accepted == Events::max_bytes / Events::max_payload && bounded->bytes() <= Events::max_bytes);
        VERIFY(bounded->enqueue(page, document, payload(Events::max_payload + 1), [](auto) { VERIFY_NOT_REACHED(); }).is_error());
        bounded->close(); VERIFY(failed == accepted);
    }
    {
        size_t failures = 0;
        auto immediate = Events::create([](auto, auto, auto, auto) -> ErrorOr<void> { return Error::from_string_literal("send failure"); });
        MUST(immediate->enqueue(page, document, payload(), [&](auto result) { VERIFY(result.is_error()); ++failures; }));
        VERIFY(failures == 1 && immediate->pending() == 0 && immediate->bytes() == 0);
        RefPtr<Events> reentrant;
        reentrant = Events::create([&](auto p, auto d, auto id, ReadonlyBytes bytes) -> ErrorOr<void> {
            reentrant->acknowledge(p, d, id, true);
            VERIFY(bytes.size() == 16 && bytes[0] == 0); // Payload survives synchronous ack.
            return {};
        });
        size_t completed = 0;
        MUST(reentrant->enqueue(page, document, payload(), [&](auto result) {
            VERIFY(!result.is_error()); ++completed;
            MUST(reentrant->enqueue(page, document, payload(), [&](auto result) { VERIFY(!result.is_error()); ++completed; }));
        }));
        VERIFY(completed == 2 && reentrant->pending() == 0 && reentrant->inflight() == 0);
    }
    {
        size_t sends = 0, cancelled = 0;
        auto cancel = Events::create([&](auto, auto, auto, auto) -> ErrorOr<void> { ++sends; return {}; });
        for (int i = 0; i < 8; ++i)
            MUST(cancel->enqueue(page, document, payload(), [&](auto result) { VERIFY(result.is_error()); ++cancelled; }));
        cancel->cancel_document(page, { 99, 3 }); VERIFY(cancelled == 0);
        cancel->cancel_document(page, document);
        VERIFY(cancelled == 8 && sends == 4 && cancel->pending() == 0 && cancel->bytes() == 0);
    }
    {
        auto churn = Events::create([](auto, auto, auto, auto) -> ErrorOr<void> { return {}; });
        Web::HTML::CrossProcessId busy_document { 2, 99 };
        size_t cancelled = 0;
        for (int i = 0; i < 4; ++i)
            MUST(churn->enqueue(page, busy_document, payload(), [](auto result) { VERIFY(result.is_error()); }));
        for (int i = 0; i < 1000; ++i) {
            MUST(churn->enqueue(page, document, payload(), [&](auto result) { VERIFY(result.is_error()); ++cancelled; }));
            churn->cancel_document(page, document);
            VERIFY(churn->queued() == 0 && churn->pending() == 4 && churn->bytes() == 64);
        }
        VERIFY(cancelled == 1000);
        churn->close();
    }
    {
        auto rejected = Events::create([](auto, auto, auto, auto) -> ErrorOr<void> { return {}; });
        size_t failures = 0;
        auto id = MUST(rejected->enqueue(page, document, payload(), [&](auto result) { VERIFY(result.is_error()); ++failures; }));
        rejected->acknowledge(page, document, id, false);
        rejected->acknowledge(page, document, id, false);
        VERIFY(failures == 1 && rejected->pending() == 0 && rejected->bytes() == 0);
    }
    {
        size_t timed_out = 0;
        auto timeout = Events::create([](auto, auto, auto, auto) -> ErrorOr<void> { return {}; }, AK::Duration::from_milliseconds(20));
        auto guard = Core::Timer::create_single_shot(AK::Duration::from_seconds(2), [&] { loop.quit(1); });
        for (size_t i = 0; i < 6; ++i)
            MUST(timeout->enqueue(page, document, payload(), [&](auto result) { VERIFY(result.is_error()); if (++timed_out == 6) loop.quit(0); }));
        auto unsent_reservation = MUST(timeout->reserve(page, document, 64));
        guard->start(); VERIFY(loop.exec() == 0); guard->stop();
        VERIFY(timeout->reserved() == 1 && timeout->bytes() == 64);
        timeout->cancel_document(page, document);
        VERIFY(timed_out == 6 && timeout->pending() == 0 && timeout->bytes() == 0);
    }
    {
        size_t sends = 0, replies = 0;
        auto channel = Events::create([&](auto, auto, auto, auto) -> ErrorOr<void> { ++sends; return {}; });
        auto reservation = MUST(channel->reserve(page, document, 128));
        auto id = reservation->id();
        channel->acknowledge(page, document, id, true);
        VERIFY(channel->reserved() == 1 && channel->bytes() == 128 && sends == 0);
        VERIFY(channel->pending() == 0 && channel->inflight() == 0);
        VERIFY(MUST(reservation->enqueue(payload(), [&](auto result) { VERIFY(!result.is_error()); ++replies; })) == id);
        VERIFY(channel->reserved() == 0 && channel->bytes() == 16 && sends == 1);
        VERIFY(reservation->enqueue(payload(), [](auto) { VERIFY_NOT_REACHED(); }).is_error());
        channel->acknowledge(page, document, id, true);
        VERIFY(replies == 1 && channel->bytes() == 0);
        {
            auto released = MUST(channel->reserve(page, document, 128));
            VERIFY(released->id() > id && channel->bytes() == 128);
        }
        VERIFY(channel->reserved() == 0 && channel->bytes() == 0);
        auto invalid = MUST(channel->reserve(page, document, 1));
        VERIFY(invalid->enqueue(payload(), [](auto) { VERIFY_NOT_REACHED(); }).is_error());
        VERIFY(channel->reserved() == 0 && channel->bytes() == 0);
        auto cancelled = MUST(channel->reserve(page, document, 128));
        channel->cancel_document(page, { 99, 3 });
        VERIFY(channel->reserved() == 1);
        channel->cancel_document(page, document);
        VERIFY(channel->reserved() == 0 && channel->bytes() == 0);
        VERIFY(cancelled->enqueue(payload(), [](auto) { VERIFY_NOT_REACHED(); }).is_error());
        Vector<NonnullRefPtr<Events::Reservation>> held;
        for (size_t i = 0; i < Events::max_pending; ++i)
            held.append(MUST(channel->reserve(page, document, 1)));
        VERIFY(channel->reserve(page, document, 1).is_error());
        VERIFY(channel->enqueue(page, document, payload(), [](auto) { VERIFY_NOT_REACHED(); }).is_error());
        held.take_last();
        auto mixed = MUST(channel->enqueue(page, document, payload(), [](auto result) { VERIFY(!result.is_error()); }));
        VERIFY(channel->pending() == 1 && channel->reserved() == Events::max_pending - 1);
        VERIFY(channel->reserve(page, document, 1).is_error());
        channel->acknowledge(page, document, mixed, true);
        held.clear();
        for (size_t i = 0; i < Events::max_bytes / Events::max_payload; ++i)
            held.append(MUST(channel->reserve(page, document, Events::max_payload)));
        VERIFY(channel->reserve(page, document, Events::max_payload).is_error());
        channel->close();
        VERIFY(channel->bytes() == 0 && channel->reserved() == 0);
        VERIFY(held[0]->enqueue(payload(), [](auto) { VERIFY_NOT_REACHED(); }).is_error());
        held.clear();
        VERIFY(sends == 2);
    }
    {
        RefPtr<Events> owner = Events::create([](auto, auto, auto, auto) -> ErrorOr<void> { VERIFY_NOT_REACHED(); });
        auto orphan = MUST(owner->reserve(page, document, 16));
        owner = nullptr;
        VERIFY(orphan->enqueue(payload(), [](auto) { VERIFY_NOT_REACHED(); }).is_error());
    }
    std::puts("Userscript event queue credits, bounds, correlation, cancellation and timeouts passed");
}
