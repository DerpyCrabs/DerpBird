#include <DerpBirdValueDispatcher.h>
#include <LibURL/Parser.h>
#include <QCoreApplication>
#include <QEventLoop>
#include <QTimer>
#include <cstdio>

using Protocol = Web::DerpBirdValueProtocol;
using Authority = Ladybird::DerpBirdValueAuthority;
using Service = Ladybird::DerpBirdValueService;
using Dispatcher = Ladybird::DerpBirdValueDispatcher;
static Authority::Context context { 1, Web::PageId { 1 }, { 2, 3 } };

static ErrorOr<Protocol::Response> execute(Authority& authority, Protocol::Request const& request, Dispatcher::EventSink events = {}, Dispatcher::ReserveEventSink reserve = {})
{
    auto payload = TRY(Protocol::encode(request));
    QEventLoop loop;
    QTimer timer;
    timer.setSingleShot(true);
    QObject::connect(&timer, &QTimer::timeout, &loop, &QEventLoop::quit);
    Optional<ErrorOr<ByteBuffer>> response;
    TRY(Dispatcher::dispatch(authority, context, URL::Parser::basic_parse("https://example.com/"sv).release_value(), true, payload.bytes(), [&](auto value) {
        response = move(value); loop.quit();
    }, move(events), move(reserve)));
    if (!response.has_value()) { timer.start(5000); loop.exec(); }
    VERIFY(response.has_value());
    auto bytes = TRY(response.release_value());
    return Protocol::decode_response(bytes.bytes());
}
int main(int argc, char** argv)
{
    QCoreApplication app(argc, argv);
    Protocol::Request request { Protocol::Method::Set, true, "capability"_string, {}, {
        { "key"_string, MUST(ByteBuffer::copy("\0\1\2\xff"sv.bytes())) } } };
    auto encoded = MUST(Protocol::encode(request));
    auto decoded = MUST(Protocol::decode_request(encoded.bytes()));
    VERIFY(decoded.updates.size() == 1 && decoded.updates[0].value->size() == 4);
    VERIFY(decoded.updates[0].value->bytes()[3] == 255);
    for (size_t i = 0; i < encoded.size(); ++i)
        VERIFY(Protocol::decode_request(encoded.bytes().slice(0, i)).is_error());
    auto bad = encoded;
    bad.append(0);
    VERIFY(Protocol::decode_request(bad.bytes()).is_error());
    bad = encoded; bad[0] = 'X'; VERIFY(Protocol::decode_request(bad.bytes()).is_error());
    bad = encoded; bad[4] = 255; VERIFY(Protocol::decode_request(bad.bytes()).is_error());
    bad = encoded; bad[5] = 2; VERIFY(Protocol::decode_request(bad.bytes()).is_error());
    bad = encoded; bad[6] = 255; bad[7] = 255; VERIFY(Protocol::decode_request(bad.bytes()).is_error());
    bad = encoded; bad[10] = 255; VERIFY(Protocol::decode_request(bad.bytes()).is_error()); // UTF-8
    auto duplicate = request; duplicate.method = Protocol::Method::SetMany; duplicate.updates.append(request.updates[0]);
    VERIFY(Protocol::encode(duplicate).is_error());
    auto wrong_method = request; wrong_method.method = Protocol::Method::Delete;
    VERIFY(Protocol::encode(wrong_method).is_error());
    Protocol::Response snapshot { Protocol::Kind::Snapshot, {}, {}, { { "empty"_string, ByteBuffer {} } }, 17 };
    auto reply = MUST(Protocol::encode(snapshot));
    for (size_t i = 0; i < reply.size(); ++i)
        VERIFY(Protocol::decode_response(reply.bytes().slice(0, i)).is_error());
    auto restored = MUST(Protocol::decode_response(reply.bytes()));
    VERIFY(restored.revision == 17 && restored.entries[0].value.has_value() && restored.entries[0].value->is_empty());
    reply.append(0); VERIFY(Protocol::decode_response(reply.bytes()).is_error());
    snapshot.kind = Protocol::Kind::Keys; VERIFY(Protocol::encode(snapshot).is_error());
    auto too_large = MUST(ByteBuffer::create_zeroed(Protocol::max_message + 1));
    VERIFY(Protocol::decode_request(too_large.bytes()).is_error());
    VERIFY(Protocol::decode_response(too_large.bytes()).is_error());
    // Deterministic mutations exercise length/type/truncation handling without
    // allocating based on untrusted counts. Every successful parse reencodes.
    for (size_t i = 0; i < encoded.size(); ++i) {
        for (u8 mask : { 1, 16, 128, 255 }) {
            auto mutation = encoded; mutation[i] ^= mask;
            auto parsed = Protocol::decode_request(mutation.bytes());
            if (!parsed.is_error()) MUST(Protocol::encode(parsed.value()));
        }
    }
    Protocol::Event event { "capability"_string, NumericLimits<u64>::max(), 42, "key"_string, true,
        MUST(ByteBuffer::copy("old"sv.bytes())), ByteBuffer {} };
    auto event_bytes = MUST(Protocol::encode(event));
    auto event_read = MUST(Protocol::decode_event(event_bytes.bytes()));
    VERIFY(event_read.subscription == event.subscription && event_read.revision == 42 && event_read.remote);
    VERIFY(event_read.identity == event.identity && event_read.key == event.key);
    VERIFY(event_read.new_value.has_value() && event_read.new_value->is_empty());
    VERIFY(StringView(event_read.old_value->bytes()) == "old"sv);
    for (size_t i = 0; i < event_bytes.size(); ++i)
        VERIFY(Protocol::decode_event(event_bytes.bytes().slice(0, i)).is_error());
    auto event_bad = event_bytes; event_bad.append(0);
    VERIFY(Protocol::decode_event(event_bad.bytes()).is_error());
    auto remote_offset = 4 + 4 + event.identity.bytes().size() + 8 + 8 + 4 + event.key.bytes().size();
    event_bad = event_bytes; event_bad[remote_offset] = 2;
    VERIFY(Protocol::decode_event(event_bad.bytes()).is_error());
    event_bad = event_bytes; event_bad[remote_offset + 1] = 2;
    VERIFY(Protocol::decode_event(event_bad.bytes()).is_error());
    event_bad = event_bytes; event_bad[4 + 4 + event.identity.bytes().size() + 8 + 7] = 255;
    VERIFY(Protocol::decode_event(event_bad.bytes()).is_error());
    event.subscription = 0; VERIFY(Protocol::encode(event).is_error());
    event.subscription = 1; event.revision = 0; VERIFY(Protocol::encode(event).is_error());
    event.revision = 1; event.old_value = {}; event.new_value = {}; VERIFY(Protocol::encode(event).is_error());
    event.new_value = MUST(ByteBuffer::create_zeroed(Protocol::max_value + 1)); VERIFY(Protocol::encode(event).is_error());
    for (auto invalid_id : { ""sv, "0"sv, "01"sv, "-1"sv, "+1"sv, " 1"sv, "1 "sv, "18446744073709551616"sv }) {
        auto text = MUST(String::from_utf8(invalid_id));
        VERIFY(!Protocol::subscription_id(text).has_value());
        VERIFY(Protocol::encode(Protocol::Request { Protocol::Method::Unsubscribe, true, "token"_string, text, {} }).is_error());
        VERIFY(Protocol::encode(Protocol::Response { Protocol::Kind::Subscription, text, {}, {}, 0 }).is_error());
    }
    for (size_t i = 0; i < event_bytes.size(); ++i) {
        for (u8 mask : { 1, 16, 128, 255 }) {
            auto mutation = event_bytes; mutation[i] ^= mask;
            auto parsed = Protocol::decode_event(mutation.bytes());
            if (!parsed.is_error()) MUST(Protocol::encode(parsed.value()));
        }
    }
    Service service({}, true);
    Authority authority(service);
    auto registry = MUST(JsonValue::from_string(R"JSON([{
        "id":"one","name":"Example","enabled":true,"fileAccessGranted":false,"source":"",
        "metadata":{"runAt":"document-end","grantNone":false,"noFrames":true,
        "matches":["https://example.com/*"],"includes":[],"excludeMatches":[],"excludes":[],
        "grants":["GM.getValue","GM.setValue","GM.deleteValue","GM.listValues","GM.getValues","GM.setValues","GM.addValueChangeListener","GM.removeValueChangeListener"],"requires":[],"connects":[],"resources":[]}
    }])JSON"sv));
    MUST(authority.replace_registry(registry));
    auto opened = MUST(execute(authority, { Protocol::Method::Open, true, "one"_string, {}, {} }));
    VERIFY(opened.kind == Protocol::Kind::Token && !opened.token.is_empty());
    request.identity = opened.token;
    auto written = MUST(execute(authority, request));
    VERIFY(written.kind == Protocol::Kind::Revision && written.revision == 1);
    auto read = MUST(execute(authority, { Protocol::Method::Get, true, opened.token, "key"_string, {} }));
    VERIFY(read.kind == Protocol::Kind::Value && read.value.has_value() && read.value->bytes()[3] == 255);
    auto missing = MUST(execute(authority, { Protocol::Method::Get, true, opened.token, "missing"_string, {} }));
    VERIFY(!missing.value.has_value());
    auto keys = MUST(execute(authority, { Protocol::Method::List, true, opened.token, {}, {} }));
    VERIFY(keys.entries.size() == 1 && keys.entries[0].key == "key"sv && !keys.entries[0].value.has_value());
    auto all = MUST(execute(authority, { Protocol::Method::GetMany, true, opened.token, {}, {} }));
    VERIFY(all.entries.size() == 1 && all.entries[0].value.has_value() && all.revision == 1);
    Protocol::Request subscribe { Protocol::Method::Subscribe, true, opened.token, "key"_string, {} };
    VERIFY(execute(authority, subscribe).is_error()); // No event transport: no leaked subscription.
    VERIFY(authority.subscription_count() == 0);
    Vector<Protocol::Event> events;
    auto subscribed = MUST(execute(authority, subscribe, [&](ByteBuffer packet) {
        events.append(MUST(Protocol::decode_event(packet.bytes())));
    }));
    VERIFY(subscribed.kind == Protocol::Kind::Subscription && Protocol::subscription_id(subscribed.token).has_value());
    MUST(execute(authority, { Protocol::Method::Set, true, opened.token, {}, { { "key"_string, MUST(ByteBuffer::copy("changed"sv.bytes())) } } }));
    VERIFY(events.size() == 1 && !events[0].remote && events[0].identity == opened.token);
    VERIFY(events[0].subscription == *Protocol::subscription_id(subscribed.token));
    VERIFY(events[0].old_value->size() == 4 && StringView(events[0].new_value->bytes()) == "changed"sv);
    auto removed = MUST(execute(authority, { Protocol::Method::Unsubscribe, true, opened.token, subscribed.token, {} }));
    VERIFY(removed.kind == Protocol::Kind::Revision && authority.subscription_count() == 0);
    MUST(execute(authority, { Protocol::Method::Delete, true, opened.token, {}, { { "key"_string, {} } } }));
    VERIFY(events.size() == 1);
    bool event_full = true;
    size_t reservations = 0;
    auto reserved_subscription = MUST(execute(authority, subscribe, {}, [&](u64, size_t bytes) -> ErrorOr<Dispatcher::EventSink> {
        VERIFY(bytes >= Protocol::max_value + 4096);
        ++reservations;
        if (event_full) return Error::from_string_literal("event transport full");
        return Dispatcher::EventSink { [&](ByteBuffer packet) { events.append(MUST(Protocol::decode_event(packet.bytes()))); } };
    }));
    Protocol::Request reserved_write { Protocol::Method::Set, true, opened.token, {}, { { "key"_string, MUST(ByteBuffer::copy("reserved"sv.bytes())) } } };
    VERIFY(execute(authority, reserved_write).is_error());
    VERIFY(!MUST(execute(authority, { Protocol::Method::Get, true, opened.token, "key"_string, {} })).value.has_value());
    event_full = false;
    MUST(execute(authority, reserved_write));
    VERIFY(reservations == 2 && events.size() == 2 && !events[1].old_value.has_value());
    VERIFY(StringView(events[1].new_value->bytes()) == "reserved"sv);
    VERIFY(events[1].subscription == *Protocol::subscription_id(reserved_subscription.token));
    MUST(execute(authority, { Protocol::Method::Unsubscribe, true, opened.token, reserved_subscription.token, {} }));
    MUST(execute(authority, { Protocol::Method::Delete, true, opened.token, {}, { { "key"_string, {} } } }));

    VERIFY(!MUST(execute(authority, { Protocol::Method::Get, true, opened.token, "key"_string, {} })).value.has_value());
    VERIFY(execute(authority, { Protocol::Method::Get, false, opened.token, "key"_string, {} }).is_error());
    VERIFY(execute(authority, { Protocol::Method::Get, true, "forged"_string, "key"_string, {} }).is_error());
    VERIFY(execute(authority, { Protocol::Method::Open, true, "unknown"_string, {}, {} }).is_error());
    Protocol::Request maximum { Protocol::Method::SetMany, true, opened.token, {}, {} };
    for (int i = 0; i < 10; ++i) {
        auto key = MUST(String::formatted("key-{}", i));
        auto size = Protocol::max_value - key.bytes().size();
        maximum.updates.append({ move(key), MUST(ByteBuffer::create_zeroed(size)) });
    }
    MUST(execute(authority, maximum)); // Exactly10MiB of stored keys + values.
    auto maximum_read = MUST(execute(authority, { Protocol::Method::GetMany, true, opened.token, {}, {} }));
    VERIFY(maximum_read.entries.size() == 10 && maximum_read.entries[9].value->size() + maximum_read.entries[9].key.bytes().size() == Protocol::max_value);
    auto selected = MUST(execute(authority, { Protocol::Method::GetMany, true, opened.token, {}, { { "key-3"_string, {} }, { "absent"_string, {} } } }));
    VERIFY(selected.kind == Protocol::Kind::Snapshot && selected.entries.size() == 1);
    VERIFY(selected.entries[0].key == "key-3"sv && selected.revision == maximum_read.revision);
    VERIFY(MUST(Protocol::encode(selected)).size() < 2 * Protocol::max_value);
    Protocol::Request invalid_selection { Protocol::Method::GetMany, true, opened.token, {}, { { "key-3"_string, ByteBuffer {} } } };
    VERIFY(Protocol::encode(invalid_selection).is_error());
    maximum.updates.append({ "overflow"_string, MUST(ByteBuffer::copy("x"sv.bytes())) });
    VERIFY(Protocol::encode(maximum).is_error());
    MUST(authority.replace_registry(JsonValue { JsonArray {} }));
    VERIFY(execute(authority, { Protocol::Method::Get, true, opened.token, "key"_string, {} }).is_error());
    std::puts("Userscript binary protocol and authorized dispatcher checks passed");
}
