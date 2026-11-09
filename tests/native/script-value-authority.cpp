#include <DerpBirdValueAuthority.h>
#include <LibURL/Parser.h>
#include <QCoreApplication>
#include <QEventLoop>
#include <QTimer>
#include <cstdio>

using Authority = Ladybird::DerpBirdValueAuthority;
using Service = Ladybird::DerpBirdValueService;
static Web::DerpBirdScriptDefinition definition(StringView id, StringView grants)
{
    auto value = MUST(JsonValue::from_string(R"JSON({
        "id":"one","name":"Example","enabled":true,"fileAccessGranted":false,
        "source":"", "metadata":{"runAt":"document-end","grantNone":false,"noFrames":true,
        "matches":["https://example.com/*"],"includes":[],"excludeMatches":[],"excludes":[],
        "grants":[],"requires":[],"connects":[],"resources":[]}
    })JSON"sv));
    value.as_object().set("id"sv, MUST(String::from_utf8(id)));
    auto metadata = *value.as_object().get_object("metadata"sv);
    metadata.set("grants"sv, MUST(JsonValue::from_string(MUST(String::formatted("[{}]", grants)))));
    value.as_object().set("metadata"sv, move(metadata));
    return MUST(Web::DerpBirdScriptDefinition::decode(value.as_object()));
}
static ErrorOr<Service::Response> execute(Authority& authority, Authority::Context context, QString const& token, Authority::Request request)
{
    QEventLoop loop;
    QTimer deadline;
    deadline.setSingleShot(true);
    QObject::connect(&deadline, &QTimer::timeout, &loop, &QEventLoop::quit);
    Optional<ErrorOr<Service::Response>> result;
    TRY(authority.submit(context, token, move(request), [&](auto response) { result = move(response); loop.quit(); }));
    deadline.start(5000); loop.exec(); VERIFY(result.has_value());
    return result.release_value();
}
static Authority::Request get() { return { Authority::Method::Get, true, "key"_string, {} }; }
static Authority::Request set()
{
    return { Authority::Method::Set, true, {}, { { "key"_string, MUST(ByteBuffer::copy("secret"sv.bytes())) } } };
}
int main(int argc, char** argv)
{
    QCoreApplication app(argc, argv);
    using Protocol = Web::DerpBirdValueProtocol;
    Protocol::Request clipboard_request { Protocol::Method::Clipboard, true, "token"_string, "text/html"_string,
        { { "clipboard"_string, MUST(ByteBuffer::copy("<b>text</b>"sv.bytes())) } } };
    auto clipboard_packet = MUST(Protocol::encode(clipboard_request));
    MUST(Protocol::decode_request(clipboard_packet.bytes()));
    clipboard_request.key = "image/png"_string;
    VERIFY(Protocol::encode(clipboard_request).is_error());
    clipboard_request.key = "text/plain"_string;
    clipboard_request.updates[0].value = {};
    VERIFY(Protocol::encode(clipboard_request).is_error());
    Service service({}, true);
    Authority authority(service);
    Authority::Context context { 1, Web::PageId { 2 }, { 7, 3 } };
    auto script = definition("one"sv, "\"GM.getValue\",\"GM.setValue\""sv);
    auto other = definition("two"sv, "\"GM.getValue\""sv);
    auto all = definition("batch"sv, "\"GM.getValues\",\"GM.setValues\",\"GM.deleteValues\",\"GM.listValues\",\"GM_deleteValue\",\"GM_getValue\""sv);
    auto tab_data = definition("tab-data"sv, "\"GM.getTab\",\"GM.saveTab\",\"GM.getTabs\""sv);
    auto menu = definition("menu"sv, "\"GM.registerMenuCommand\",\"GM.unregisterMenuCommand\""sv);
    auto cookies = definition("cookies"sv, "\"GM.cookie\""sv);
    auto notifications = definition("notifications"sv, "\"GM.notification\""sv);
    auto downloads = definition("downloads"sv, "\"GM.download\""sv);
    auto tabs = definition("tabs"sv, "\"GM.openInTab\""sv);
    auto clipboard = definition("clipboard"sv, "\"GM.setClipboard\""sv);
    JsonArray records;
    for (auto const* installed : { &script, &other, &all, &clipboard, &tabs, &menu, &tab_data, &downloads, &notifications, &cookies })
        records.must_append(MUST(JsonValue::from_string(installed->configuration)));
    MUST(authority.replace_registry(records));
    auto url = URL::Parser::basic_parse("https://example.com/path"sv).release_value();
    {
        Authority normal_context(service, false);
        Authority private_context(service, true);
        JsonArray scoped;
        for (auto run_in : { "normal-tabs"sv, "incognito-tabs"sv }) {
            auto installed = definition(run_in, "\"GM.audio\",\"window.close\""sv);
            auto item = MUST(JsonValue::from_string(installed.configuration));
            auto metadata = item.as_object().get_object("metadata"sv).value();
            JsonObject entry;
            entry.set("key"sv, "run-in"sv);
            entry.set("value"sv, run_in);
            JsonArray entries;
            entries.must_append(move(entry));
            metadata.set("entries"sv, move(entries));
            item.as_object().set("metadata"sv, move(metadata));
            scoped.must_append(move(item));
        }
        MUST(normal_context.replace_registry(scoped));
        MUST(private_context.replace_registry(scoped));
        VERIFY(normal_context.issue(context, "incognito-tabs"_string, url, true).is_error());
        VERIFY(private_context.issue(context, "normal-tabs"_string, url, true).is_error());
        auto normal_token = MUST(normal_context.issue(context, "normal-tabs"_string, url, true));
        auto private_token = MUST(private_context.issue(context, "incognito-tabs"_string, url, true));
        MUST(normal_context.audio_permission(context, normal_token, Protocol::Method::Audio));
        VERIFY(normal_context.audio_permission(context, normal_token, Protocol::Method::AudioLegacy).is_error());
        MUST(normal_context.window_permission(context, normal_token, Protocol::Method::WindowClose));
        VERIFY(normal_context.window_permission(context, normal_token, Protocol::Method::WindowFocus).is_error());
        VERIFY(normal_context.audio_permission({99, context.page, context.document}, normal_token, Protocol::Method::Audio).is_error());
        VERIFY(normal_context.audio_permission(context, private_token, Protocol::Method::Audio).is_error());
        MUST(normal_context.replace_registry(JsonArray {}));
        VERIFY(normal_context.audio_permission(context, normal_token, Protocol::Method::Audio).is_error());
        VERIFY(normal_context.window_permission(context, normal_token, Protocol::Method::WindowClose).is_error());
        MUST(private_context.audio_permission(context, private_token, Protocol::Method::Audio));
        Protocol::Request audio_request { Protocol::Method::Audio, true, "token"_string, "get"_string,
            { { "audio"_string, MUST(ByteBuffer::copy("{}"sv.bytes())) } } };
        auto audio_packet = MUST(Protocol::encode(audio_request));
        MUST(Protocol::decode_request(audio_packet.bytes()));
        audio_request.asynchronous = false;
        VERIFY(Protocol::encode(audio_request).is_error());
        audio_request.asynchronous = true;
        audio_request.key = "unknown"_string;
        VERIFY(Protocol::encode(audio_request).is_error());
    }
    VERIFY(authority.issue(context, "uninstalled"_string, url, true).is_error());
    auto cookie_token = MUST(authority.issue(context, "cookies"_string, url, true));
    MUST(authority.cookie_permission(context, cookie_token, Protocol::Method::Cookie, url));
    VERIFY(authority.cookie_permission(context, cookie_token, Protocol::Method::CookieLegacy, url).is_error());
    VERIFY(authority.cookie_permission(context, cookie_token, Protocol::Method::Cookie, URL::Parser::basic_parse("https://unmatched.example/path"sv).release_value()).is_error());
    VERIFY(authority.cookie_permission({ 99, context.page, context.document }, cookie_token, Protocol::Method::Cookie, url).is_error());
    Protocol::Request cookie_request { Protocol::Method::Cookie, true, "token"_string, "list"_string,
        { { "cookie"_string, MUST(ByteBuffer::copy("{}"sv.bytes())) } } };
    auto cookie_packet = MUST(Protocol::encode(cookie_request));
    MUST(Protocol::decode_request(cookie_packet.bytes()));
    cookie_request.key = "wipe"_string;
    VERIFY(Protocol::encode(cookie_request).is_error());
    cookie_request.key = "list"_string;
    cookie_request.asynchronous = false;
    VERIFY(Protocol::encode(cookie_request).is_error());

    VERIFY(authority.issue({ 1, Web::PageId { 2 }, { 0, 3 } }, script.id, url, true).is_error());
    VERIFY(authority.issue({ 1, Web::PageId { 2 }, { 7, 0 } }, script.id, url, true).is_error());
    auto token = MUST(authority.issue(context, script.id, url, true));
    auto notification_token=MUST(authority.issue(context,notifications.id,url,true));
    MUST(authority.notification_permission(context,notification_token,Authority::Method::Notify));
    MUST(authority.notification_permission(context,notification_token,Authority::Method::NotifyWait));
    MUST(authority.notification_permission(context,notification_token,Authority::Method::NotifyActivate));
    VERIFY(authority.notification_permission(context,notification_token,Authority::Method::NotifyLegacy).is_error());
    VERIFY(authority.notification_permission(context,token,Authority::Method::Notify).is_error());
    VERIFY(authority.notification_permission({999,Web::PageId{2},{7,3}},notification_token,Authority::Method::NotifyWait).is_error());
    authority.revoke_script(notifications.id);VERIFY(authority.notification_permission(context,notification_token,Authority::Method::NotifyWait).is_error());
    auto download_token = MUST(authority.issue(context, downloads.id, url, true));
    for (auto method : { Authority::Method::Download, Authority::Method::DownloadAbort, Authority::Method::DownloadWatch, Authority::Method::DownloadChunk, Authority::Method::DownloadFinish })
        MUST(authority.download_permission(context, download_token, method));
    VERIFY(authority.download_permission(context, download_token, Authority::Method::DownloadLegacy).is_error());
    VERIFY(authority.download_permission(context, token, Authority::Method::Download).is_error());
    VERIFY(authority.download_permission({999,Web::PageId{2},{7,3}}, download_token, Authority::Method::DownloadAbort).is_error());
    authority.revoke_script(downloads.id);
    VERIFY(authority.download_permission(context, download_token, Authority::Method::DownloadWatch).is_error());
    auto data_token = MUST(authority.issue(context, tab_data.id, url, true));
    for (auto method : { Authority::Method::TabGet, Authority::Method::TabSave, Authority::Method::TabsGet })
        VERIFY(MUST(authority.tab_data_permission(context, data_token, method)) == tab_data.id);
    for (auto method : { Authority::Method::TabGetLegacy, Authority::Method::TabSaveLegacy, Authority::Method::TabsGetLegacy })
        VERIFY(authority.tab_data_permission(context, data_token, method).is_error());
    VERIFY(authority.tab_data_permission(context, token, Authority::Method::TabsGet).is_error());
    VERIFY(authority.tab_data_permission({999, Web::PageId {2}, {7,3}}, data_token, Authority::Method::TabGet).is_error());
    authority.revoke_script(tab_data.id);
    VERIFY(authority.tab_data_permission(context, data_token, Authority::Method::TabGet).is_error());
    auto menu_token = MUST(authority.issue(context, menu.id, url, true));
    VERIFY(MUST(authority.menu_permission(context,menu_token,Authority::Method::MenuRegister)).id == menu.id);
    MUST(authority.menu_permission(context,menu_token,Authority::Method::MenuWait));
    MUST(authority.menu_permission(context,menu_token,Authority::Method::MenuRemove));
    VERIFY(authority.menu_permission(context,menu_token,Authority::Method::MenuRegisterLegacy).is_error());
    VERIFY(authority.menu_permission(context,token,Authority::Method::MenuWait).is_error());
    VERIFY(authority.menu_permission({999,Web::PageId{2},{7,3}},menu_token,Authority::Method::MenuWait).is_error());
    authority.revoke_script(menu.id);
    VERIFY(authority.menu_permission(context,menu_token,Authority::Method::MenuRegister).is_error());
    auto tab_token = MUST(authority.issue(context, tabs.id, url, true));
    MUST(authority.tab_permission(context, tab_token, Authority::Method::TabOpen));
    MUST(authority.tab_permission(context, tab_token, Authority::Method::TabClose));
    VERIFY(authority.tab_permission(context, tab_token, Authority::Method::TabOpenLegacy).is_error());
    VERIFY(authority.tab_permission(context, token, Authority::Method::TabWatch).is_error());
    VERIFY(authority.tab_permission({ 999, Web::PageId { 2 }, { 7, 3 } }, tab_token, Authority::Method::TabClose).is_error());
    authority.revoke_script(tabs.id);
    VERIFY(authority.tab_permission(context, tab_token, Authority::Method::TabOpen).is_error());
    auto clipboard_token = MUST(authority.issue(context, clipboard.id, url, true));
    MUST(authority.clipboard_permission(context, clipboard_token, Authority::Method::Clipboard));
    VERIFY(authority.clipboard_permission(context, token, Authority::Method::Clipboard).is_error());
    VERIFY(authority.clipboard_permission(context, clipboard_token, Authority::Method::ClipboardLegacy).is_error());
    VERIFY(authority.clipboard_permission({ 999, Web::PageId { 2 }, { 7, 3 } }, clipboard_token, Authority::Method::Clipboard).is_error());
    authority.revoke_script(clipboard.id);
    VERIFY(authority.clipboard_permission(context, clipboard_token, Authority::Method::Clipboard).is_error());
    MUST(authority.replace_registry(records));
    VERIFY(authority.replace_registry(JsonValue { false }).is_error());
    size_t committed_events = 0;
    service.set_change_callback([&](String const& scope, String const& origin, Service::Store::Commit const& commit, u64 sequence) {
            VERIFY(sequence > 0);
        auto expected_origin = token.toUtf8();
        VERIFY(scope == script.id && origin.bytes_as_string_view() == StringView(expected_origin.constData(), expected_origin.size()));
        VERIFY(commit.revision == 1 && commit.changes.size() == 1 && !commit.changes[0].old_value.has_value());
        VERIFY(StringView(commit.changes[0].new_value->bytes()) == "secret"sv);
        ++committed_events;
    });
    MUST(execute(authority, context, token, set()));
    VERIFY(committed_events == 1);
    service.set_change_callback({});
    auto read = MUST(execute(authority, context, token, get()));
    VERIFY(StringView(read.get<Optional<ByteBuffer>>()->bytes()) == "secret"sv);

    auto other_token = MUST(authority.issue(context, other.id, url, true));
    VERIFY(!MUST(execute(authority, context, other_token, get())).get<Optional<ByteBuffer>>().has_value());
    VERIFY(execute(authority, context, other_token, set()).is_error());
    VERIFY(execute(authority, { 4, Web::PageId { 2 }, { 7, 3 } }, token, get()).is_error());
    VERIFY(execute(authority, { 1, Web::PageId { 4 }, { 7, 3 } }, token, get()).is_error());
    VERIFY(execute(authority, { 1, Web::PageId { 2 }, { 7, 4 } }, token, get()).is_error());
    VERIFY(execute(authority, { 1, Web::PageId { 2 }, { 8, 3 } }, token, get()).is_error());
    VERIFY(execute(authority, context, "forged", get()).is_error());
    auto legacy = get(); legacy.asynchronous = false;
    VERIFY(execute(authority, context, token, move(legacy)).is_error());
    auto deletion = set(); deletion.updates[0].value = {};
    VERIFY(execute(authority, context, token, move(deletion)).is_error());
    auto batch = set(); batch.updates.append({ "other"_string, MUST(ByteBuffer::copy("x"sv.bytes())) });
    VERIFY(execute(authority, context, token, move(batch)).is_error());
    VERIFY(authority.issue(context, script.id, url, false).is_error());
    VERIFY(authority.issue(context, script.id, URL::Parser::basic_parse("https://other.test/"sv).release_value(), true).is_error());
    auto disabled = records;
    disabled.values()[0].as_object().set("enabled"sv, false);
    MUST(authority.replace_registry(disabled));
    VERIFY(authority.issue(context, script.id, url, true).is_error());
    auto no_grants = records;
    auto none_metadata = *no_grants.values()[0].as_object().get_object("metadata"sv);
    none_metadata.set("grantNone"sv, true);
    none_metadata.set("grants"sv, JsonArray {});
    no_grants.values()[0].as_object().set("metadata"sv, move(none_metadata));
    MUST(authority.replace_registry(no_grants));
    VERIFY(authority.issue(context, script.id, url, true).is_error());
    MUST(authority.replace_registry(records));
    token = MUST(authority.issue(context, script.id, url, true));
    // Revoke between request acceptance and UI delivery. The old response must
    // return an error, even if a fresh capability for the same script is issued.
    QEventLoop loop;
    QTimer deadline;
    deadline.setSingleShot(true);
    QObject::connect(&deadline, &QTimer::timeout, &loop, &QEventLoop::quit);
    bool revoked_reply = false;
    MUST(authority.submit(context, token, get(), [&](auto response) { VERIFY(response.is_error()); revoked_reply = true; loop.quit(); }));
    MUST(authority.replace_registry(disabled));
    MUST(authority.replace_registry(records));
    auto fresh = MUST(authority.issue(context, script.id, url, true));
    VERIFY(fresh != token);
    deadline.start(5000); loop.exec(); VERIFY(revoked_reply);
    VERIFY(execute(authority, context, token, get()).is_error());
    MUST(execute(authority, context, fresh, get()));
    MUST(execute(authority, context, other_token, get()));
    authority.revoke_document(context);
    VERIFY(execute(authority, context, other_token, get()).is_error());
    auto connection_token = MUST(authority.issue(context, script.id, url, true));
    auto independent = MUST(authority.issue({ 9, Web::PageId { 2 }, { 7, 3 } }, script.id, url, true));
    authority.revoke_connection(1);
    VERIFY(execute(authority, context, connection_token, get()).is_error());
    MUST(execute(authority, { 9, Web::PageId { 2 }, { 7, 3 } }, independent, get()));

    auto all_token = MUST(authority.issue(context, all.id, url, true));
    Authority::Request multiple { Authority::Method::SetMany, true, {}, {
        { "a"_string, MUST(ByteBuffer::copy("a"sv.bytes())) },
        { "b"_string, MUST(ByteBuffer::copy("b"sv.bytes())) } } };
    MUST(execute(authority, context, all_token, move(multiple)));
    auto snapshot = MUST(execute(authority, context, all_token, { Authority::Method::GetMany, true, {}, {} }));
    VERIFY(snapshot.get<Service::Store::Snapshot>().values.size() == 2);
    auto keys = MUST(execute(authority, context, all_token, { Authority::Method::List, true, {}, {} }));
    VERIFY(keys.get<Vector<String>>().size() == 2);
    auto single_read = MUST(execute(authority, context, all_token, { Authority::Method::Get, false, "a"_string, {} }));
    VERIFY(single_read.get<Optional<ByteBuffer>>().has_value());
    MUST(execute(authority, context, all_token, { Authority::Method::Delete, false, {}, { { "a"_string, {} } } }));
    // A delete grant cannot be used to smuggle a set payload.
    VERIFY(execute(authority, context, all_token, { Authority::Method::DeleteMany, true, {}, {
        { "b"_string, MUST(ByteBuffer::copy("replacement"sv.bytes())) } } }).is_error());
    MUST(execute(authority, context, all_token, { Authority::Method::DeleteMany, true, {}, { { "b"_string, {} } } }));
    VERIFY(MUST(execute(authority, context, all_token, { Authority::Method::List, true, {}, {} })).get<Vector<String>>().is_empty());
    // Destroying the authority while its worker reply is pending also revokes it.
    bool destroyed_reply = false;
    {
        Authority temporary(service);
        MUST(temporary.replace_registry(records));
        auto temporary_token = MUST(temporary.issue(context, script.id, url, true));
        MUST(temporary.submit(context, temporary_token, get(), [&](auto response) {
            VERIFY(response.is_error()); destroyed_reply = true; loop.quit();
        }));
    }
    deadline.start(5000); loop.exec(); VERIFY(destroyed_reply);
    auto editable = MUST(authority.issue(context, script.id, url, true));
    auto edited = records;
    edited.values()[0].as_object().set("source"sv, "console.log('new source')"sv);
    MUST(authority.replace_registry(edited));
    VERIFY(execute(authority, context, editable, get()).is_error());
    auto changed_token = MUST(authority.issue(context, script.id, url, true));
    MUST(execute(authority, context, changed_token, get()));
    // Updating another script must preserve an existing batch script capability.
    MUST(execute(authority, context, all_token, { Authority::Method::List, true, {}, {} }));
    auto limited = edited;
    auto metadata = *limited.values()[0].as_object().get_object("metadata"sv);
    JsonArray read_only;
    read_only.must_append("GM.getValue"sv);
    metadata.set("grants"sv, move(read_only));
    limited.values()[0].as_object().set("metadata"sv, move(metadata));
    MUST(authority.replace_registry(limited));
    VERIFY(execute(authority, context, changed_token, get()).is_error());
    auto limited_token = MUST(authority.issue(context, script.id, url, true));
    MUST(execute(authority, context, limited_token, get()));
    VERIFY(execute(authority, context, limited_token, set()).is_error());
    MUST(authority.replace_registry(JsonValue { JsonArray {} }));
    VERIFY(execute(authority, context, limited_token, get()).is_error());
    VERIFY(authority.issue(context, script.id, url, true).is_error());
    {
        Service watched_service({}, true);
        Authority watched(watched_service);
        auto watcher = definition("watch"sv, "\"GM.getValue\",\"GM.setValue\",\"GM.addValueChangeListener\",\"GM.removeValueChangeListener\""sv);
        JsonArray watching_records;
        watching_records.must_append(MUST(JsonValue::from_string(watcher.configuration)));
        watching_records.must_append(MUST(JsonValue::from_string(other.configuration)));
        MUST(watched.replace_registry(watching_records));
        Authority::Context a { 10, Web::PageId { 1 }, { 10, 1 } };
        Authority::Context b { 11, Web::PageId { 1 }, { 11, 1 } };
        auto a_token = MUST(watched.issue(a, watcher.id, url, true));
        auto b_token = MUST(watched.issue(b, watcher.id, url, true));
        auto denied = MUST(watched.issue(a, other.id, url, true));
        auto write_value = [](StringView payload) {
            return Authority::Request { Authority::Method::Set, true, {}, { { "key"_string, MUST(ByteBuffer::copy(payload.bytes())) } } };
        };
        size_t a_events = 0, b_events = 0;
        auto a_id = MUST(watched.subscribe(a, a_token, "key"_string, true, [&](u64, i64, auto const& change, bool remote) {
            VERIFY(!remote && change.key == "key"sv && change.new_value.has_value()); ++a_events;
        }));
        VERIFY(watched.subscribe(a, denied, "key"_string, true, [](auto, auto, auto const&, bool) { VERIFY_NOT_REACHED(); }).is_error());
        VERIFY(watched.subscribe(b, a_token, "key"_string, true, [](auto, auto, auto const&, bool) { VERIFY_NOT_REACHED(); }).is_error());
        VERIFY(watched.subscribe(a, a_token, "key"_string, false, [](auto, auto, auto const&, bool) { VERIFY_NOT_REACHED(); }).is_error());
        // Accepted before registration, but still queued: B must not get history.
        bool first_done = false;
        MUST(watched.submit(a, a_token, write_value("first"sv), [&](auto response) { VERIFY(!response.is_error()); first_done = true; loop.quit(); }));
        auto b_id = MUST(watched.subscribe(b, b_token, "key"_string, true, [&](u64, i64, auto const&, bool remote) {
            VERIFY(remote); ++b_events;
        }));
        deadline.start(5000); loop.exec(); VERIFY(first_done);
        VERIFY(a_events == 1 && b_events == 0);
        MUST(execute(watched, a, a_token, write_value("second"sv)));
        VERIFY(a_events == 2 && b_events == 1);
        MUST(execute(watched, a, a_token, write_value("second"sv)));
        VERIFY(a_events == 2 && b_events == 1); // Byte-identical write has no event.
        VERIFY(watched.unsubscribe(a, a_token, b_id, true).is_error());
        VERIFY(MUST(watched.unsubscribe(b, b_token, b_id, true)));
        VERIFY(!MUST(watched.unsubscribe(b, b_token, b_id, true)));
        auto ignored_key = MUST(watched.subscribe(b, b_token, "other-key"_string, true, [](auto, auto, auto const&, bool) { VERIFY_NOT_REACHED(); }));
        MUST(execute(watched, a, a_token, write_value("third"sv)));
        VERIFY(a_events == 3 && b_events == 1);
        MUST(watched.unsubscribe(b, b_token, ignored_key, true));
        // A callback can remove itself while its callable remains alive.
        u64 self_id = 0;
        size_t self_events = 0;
        self_id = MUST(watched.subscribe(b, b_token, "key"_string, true, [&](auto, auto, auto const&, bool) {
            MUST(watched.unsubscribe(b, b_token, self_id, true)); ++self_events;
        }));
        MUST(execute(watched, a, a_token, write_value("fourth"sv)));
        MUST(execute(watched, a, a_token, write_value("fifth"sv)));
        VERIFY(self_events == 1 && watched.subscription_count() == 1);
        // B is revoked after write acceptance, before delivery.
        MUST(watched.subscribe(b, b_token, "key"_string, true, [](auto, auto, auto const&, bool) { VERIFY_NOT_REACHED(); }));
        bool revoked_done = false;
        MUST(watched.submit(a, a_token, write_value("sixth"sv), [&](auto response) { VERIFY(!response.is_error()); revoked_done = true; loop.quit(); }));
        watched.revoke_document(b);
        deadline.start(5000); loop.exec(); VERIFY(revoked_done);
        VERIFY(watched.subscription_count() == 1 && a_events == 6);
        auto b2_token = MUST(watched.issue(b, watcher.id, url, true));
        u64 killer = 0, victim = 0;
        size_t late_events = 0;
        killer = MUST(watched.subscribe(b, b2_token, "key"_string, true, [&](auto, auto, auto const&, bool) {
            MUST(watched.unsubscribe(b, b2_token, killer, true));
            MUST(watched.unsubscribe(b, b2_token, victim, true));
            MUST(watched.subscribe(b, b2_token, "key"_string, true, [&](auto, auto, auto const&, bool remote) { VERIFY(remote); ++late_events; }));
        }));
        victim = MUST(watched.subscribe(b, b2_token, "key"_string, true, [](auto, auto, auto const&, bool) { VERIFY_NOT_REACHED(); }));
        MUST(execute(watched, a, a_token, write_value("seventh"sv)));
        VERIFY(late_events == 0);
        MUST(execute(watched, a, a_token, write_value("eighth"sv)));
        VERIFY(late_events == 1 && a_events == 8);
        watched.revoke_document(b);
        VERIFY(watched.subscription_count() == 1);
        Authority::Context c { 12, Web::PageId { 1 }, { 12, 1 } };
        auto c_token = MUST(watched.issue(c, watcher.id, url, true));
        for (size_t i = 0; i < 128; ++i)
            MUST(watched.subscribe(c, c_token, "key"_string, true, [](auto, auto, auto const&, bool) { VERIFY_NOT_REACHED(); }));
        VERIFY(watched.subscribe(c, c_token, "key"_string, true, [](auto, auto, auto const&, bool) { VERIFY_NOT_REACHED(); }).is_error());
        watched.revoke_connection(c.connection);
        VERIFY(watched.subscription_count() == 1);
        MUST(watched.replace_registry(watching_records));
        VERIFY(watched.subscription_count() == 1);
        auto edited_watch = watching_records;
        edited_watch.values()[0].as_object().set("source"sv, "changed"sv);
        MUST(watched.replace_registry(edited_watch));
        VERIFY(watched.subscription_count() == 0);
        VERIFY(watched.unsubscribe(a, a_token, a_id, true).is_error());
        for (size_t scope = 0; scope < 32; ++scope) {
            auto quota_token = MUST(watched.issue(a, watcher.id, url, true));
            for (size_t i = 0; i < 128; ++i)
                MUST(watched.subscribe(a, quota_token, "quota"_string, true, [](auto, auto, auto const&, bool) { VERIFY_NOT_REACHED(); }));
        }
        VERIFY(watched.subscription_count() == 4096);
        auto overflow_token = MUST(watched.issue(a, watcher.id, url, true));
        VERIFY(watched.subscribe(a, overflow_token, "quota"_string, true, [](auto, auto, auto const&, bool) { VERIFY_NOT_REACHED(); }).is_error());
        watched.revoke_script(watcher.id);
        VERIFY(watched.subscription_count() == 0);
        auto reusable_token = MUST(watched.issue(a, watcher.id, url, true));
        MUST(watched.subscribe(a, reusable_token, "quota"_string, true, [](auto, auto, auto const&, bool) { VERIFY_NOT_REACHED(); }));
        VERIFY(watched.subscription_count() == 1);
        watched.revoke_script(watcher.id);

    }
    {
        Service queued({}, true);
        Authority admitted(queued);
        auto listener = definition("reserved"sv, "\"GM.getValue\",\"GM.setValue\",\"GM.addValueChangeListener\",\"GM.removeValueChangeListener\""sv);
        JsonArray registry;
        registry.must_append(MUST(JsonValue::from_string(listener.configuration)));
        MUST(admitted.replace_registry(registry));
        auto owner = MUST(admitted.issue(context, listener.id, url, true));
        size_t held = 0, delivered = 0, attempts = 0;
        bool full = true;
        struct Lease { size_t& held; Lease(size_t& count) : held(count) { ++held; } ~Lease() { --held; } };
        auto id = MUST(admitted.subscribe(context, owner, "key"_string, true,
            [](auto, auto, auto const&, bool) { VERIFY_NOT_REACHED(); },
            [&](u64, size_t bytes) -> ErrorOr<Authority::Notification> {
                ++attempts;
                VERIFY(bytes == Service::Store::max_value_bytes + 4096 + 6);
                if (full) return Error::from_string_literal("transport full");
                auto lease = std::make_shared<Lease>(held);
                return Authority::Notification { [&, lease](auto, auto, auto const& change, bool remote) {
                    VERIFY(!remote && held == 1 && change.new_value.has_value());
                    ++delivered;
                } };
            }));
        auto before = queued.last_sequence();
        VERIFY(execute(admitted, context, owner, set()).is_error());
        VERIFY(queued.last_sequence() == before && held == 0 && attempts == 1);
        VERIFY(!MUST(execute(admitted, context, owner, get())).get<Optional<ByteBuffer>>().has_value());
        full = false;
        MUST(execute(admitted, context, owner, set()));
        VERIFY(delivered == 1 && held == 0);
        MUST(execute(admitted, context, owner, set())); // Identical value: no notification, no retained lease.
        VERIFY(delivered == 1 && held == 0 && attempts == 3);
        auto refusing = MUST(admitted.subscribe(context, owner, "key"_string, true,
            [](auto, auto, auto const&, bool) { VERIFY_NOT_REACHED(); },
            [](u64, size_t) -> ErrorOr<Authority::Notification> { return Error::from_string_literal("second transport full"); }));
        before = queued.last_sequence();
        VERIFY(execute(admitted, context, owner, set()).is_error());
        VERIFY(held == 0 && queued.last_sequence() == before);
        MUST(admitted.unsubscribe(context, owner, refusing, true));
        QEventLoop pending;
        auto changed = set(); changed.updates[0].value = MUST(ByteBuffer::copy("update"sv.bytes()));
        MUST(admitted.submit(context, owner, move(changed), [&](auto result) { VERIFY(!result.is_error()); pending.quit(); }));
        VERIFY(held == 1);
        MUST(admitted.unsubscribe(context, owner, id, true));
        VERIFY(held == 0);
        QTimer::singleShot(5000, &pending, &QEventLoop::quit);
        pending.exec();
        VERIFY(queued.pending() == 0 && delivered == 1);
        Service unavailable({}, false); // Persistent service rejects an empty directory on its worker.
        Authority failing(unavailable);
        MUST(failing.replace_registry(registry));
        auto failed_owner = MUST(failing.issue(context, listener.id, url, true));
        MUST(failing.subscribe(context, failed_owner, "key"_string, true,
            [](auto, auto, auto const&, bool) { VERIFY_NOT_REACHED(); },
            [&](u64, size_t) -> ErrorOr<Authority::Notification> {
                auto lease = std::make_shared<Lease>(held);
                return Authority::Notification { [lease](auto, auto, auto const&, bool) { VERIFY_NOT_REACHED(); } };
            }));
        VERIFY(execute(failing, context, failed_owner, set()).is_error());
        VERIFY(held == 0);
        MUST(unavailable.close({}));
        VERIFY(execute(failing, context, failed_owner, set()).is_error());
        VERIFY(held == 0);

    }
    std::puts("Userscript value authority checks passed");
}
