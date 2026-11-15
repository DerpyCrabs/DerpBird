#include <DerpBirdValueHost.h>
#include "HeadlessTest.h"
#include <LibCore/Environment.h>
#include <LibGfx/SystemTheme.h>
#include <LibWebView/HeadlessWebView.h>
#include <LibWebView/Utilities.h>
#include <LibWebView/WebContentTestClient.h>
#include <LibWebCommon/WebView/ConsoleOutput.h>
#include <QCoreApplication>
#include <QFile>
#include <cstdio>

using Protocol = Web::DerpBirdValueProtocol;
int main(int argc, char** argv)
{
    QCoreApplication qt(argc, argv);
    Test::HeadlessTestEnvironment environment { "DerpBirdQtValueHost"sv, 90 };
    MUST(Core::Environment::set("XDG_DATA_HOME"sv, environment.directory(), Core::Environment::Overwrite::Yes));
    auto pump = Core::Timer::create_repeating(AK::Duration::from_milliseconds(1), [] { QCoreApplication::processEvents(); });
    pump->start();
    auto app = MUST(environment.create_application());
    Ladybird::DerpBirdValueHost host(*app);
    auto registry = MUST(JsonValue::from_string(R"JSON([{
        "id":"one","name":"Fixture","enabled":true,"fileAccessGranted":true,"source":"",
        "metadata":{"runAt":"document-end","grantNone":false,"noFrames":true,
        "matches":["file:///*"],"includes":[],"excludeMatches":[],"excludes":[],
        "grants":["GM.getValue","GM.setValue","GM.deleteValue","GM.listValues","GM.getValues","GM.setValues","GM.deleteValues","GM.addValueChangeListener","GM.removeValueChangeListener"],"requires":[],"connects":[],"resources":[]}
    }])JSON"sv));
    registry.as_array().values()[0].as_object().set("source"sv, R"JS(
        (async()=>{
            if (GM.info !== GM_info || GM_info.script.name !== 'Fixture') throw new Error('metadata');
            await GM.deleteValue('watch');
            let seen=0;
            const listener=await GM.addValueChangeListener('watch',(key,oldValue,newValue,remote)=>{
                if(key!=='watch'||oldValue!==undefined||newValue!==42||remote!==false)throw new Error('listener arguments');
                ++seen;
            });
            if(typeof listener!=='number')throw new Error('listener id');
            await GM.setValue('watch',42);
            if(seen!==1)throw new Error('listener delivery');
            await GM.removeValueChangeListener(listener);
            await GM.setValue('watch',43);
            if(seen!==1)throw new Error('listener removal');
            await GM.deleteValue('watch');
            const changes=[];
            await GM.addValueChangeListener('count',(key,oldValue,newValue,remote)=>{
                changes.push([key,oldValue,newValue,remote]);
                document.documentElement.setAttribute('data-gm-events',JSON.stringify(changes));
            });
            let survivorEvents=0,throwingEvents=0;
            const throwing=await GM.addValueChangeListener('exceptions',()=>{++throwingEvents;throw Error('expected listener exception');});
            const survivor=await GM.addValueChangeListener('exceptions',()=>{++survivorEvents;});
            await GM.setValue('exceptions',1);
            await GM.setValue('exceptions',2);
            if(throwingEvents!==2||survivorEvents!==2)throw Error('exception interrupted listeners');
            await GM.removeValueChangeListener(throwing);
            await GM.removeValueChangeListener(survivor);
            await GM.deleteValue('exceptions');
            const count=await GM.getValue('count',0);
            await GM.setValue('count',count+1);
            await GM.setValue('remove-me',{nested:undefined,n:NaN});
            const value=await GM.getValue('remove-me');
            if(!Object.hasOwn(value,'nested')||!Number.isNaN(value.n))throw new Error('types');
            await GM.deleteValue('remove-me');
            if((await GM.listValues()).includes('remove-me'))throw new Error('delete');
            await GM.setValues({batchA:1,batchB:{text:'batch'},batchU:undefined});
            const defaults={fallback:true};
            const batch=await GM.getValues({batchA:0,batchB:null,batchU:9,absent:defaults});
            if(batch.batchA!==1||batch.batchB.text!=='batch'||batch.batchU!==undefined||batch.absent!==defaults)throw new Error('batch read');
            await GM.deleteValues(['batchA','batchB','batchU','batchA']);
            const gone=await GM.getValues(['batchA','batchB','batchU']);
            if(Object.keys(gone).length!==3||Object.values(gone).some(x=>x!==undefined))throw new Error('batch delete');
            if(benchmarkIterations){
                const writes=[],reads=[],notifications=[];let sent=0;
                const benchListener=await GM.addValueChangeListener('benchmark',()=>notifications.push(performance.now()-sent));
                for(let i=0;i<benchmarkIterations;i++){
                    sent=performance.now();await GM.setValue('benchmark',i);writes.push(performance.now()-sent);
                    const start=performance.now();const value=await GM.getValue('benchmark');reads.push(performance.now()-start);
                    if(value!==i)throw Error('benchmark value');
                }
                await GM.removeValueChangeListener(benchListener);await GM.deleteValue('benchmark');
                function summary(values){values.sort((a,b)=>a-b);return {n:values.length,p50:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],max:values[values.length-1]};}
                document.documentElement.setAttribute('data-gm-benchmark',JSON.stringify({writes:summary(writes),reads:summary(reads),notifications:summary(notifications)}));
            }
            document.documentElement.setAttribute('data-gm-count',String(await GM.getValue('count')));
        })().catch(e=>document.documentElement.setAttribute('data-gm-count','ERROR:'+e));
    )JS"sv);
    auto& script_record = registry.as_array().values()[0].as_object();
    auto original_source = *script_record.get_string("source"sv);
    script_record.set("source"sv, MUST(String::formatted("const benchmarkIterations={};\n{}", getenv("DERPBIRD_GM_BENCHMARK") ? 120 : 0, original_source)));
    auto event_definition = registry.as_array().values()[0];
    event_definition.as_object().set("id"sv, "events"sv);
    event_definition.as_object().set("source"sv, ""sv);
    auto event_metadata = *event_definition.as_object().get_object("metadata"sv);
    event_metadata.set("grants"sv, MUST(JsonValue::from_string(R"JSON(["GM.getValue","GM.setValue","GM.addValueChangeListener","GM.removeValueChangeListener"])JSON"sv)));
    event_definition.as_object().set("metadata"sv, move(event_metadata));
    registry.as_array().must_append(move(event_definition));
    MUST(app->set_derpbird_user_scripts(registry));
    auto path = ByteString::formatted("{}/fixture.html", environment.directory());
    QFile file(QString::fromUtf8(path.characters()));
    VERIFY(file.open(QIODevice::WriteOnly));
    VERIFY(file.write("<!doctype html><title>Storage fixture</title><body>fixture</body>") > 0);
    file.close();
    auto url = URL::create_with_file_scheme(path).release_value();
    auto theme = MUST(Gfx::load_system_theme(ByteString::formatted("{}/themes/Default.ini", WebView::s_ladybird_resource_root)));
    auto normal = WebView::HeadlessWebView::create(theme, { 800, 600 });
    auto private_view = WebView::HeadlessWebView::create(theme, { 800, 600 }, WebView::IsPrivate::Yes);
    bool crashed = false;
    auto load = [&](auto& view, int expected_count) {
        bool loaded = false;
        view.on_web_content_crashed = [&](auto) { crashed = true; };
        view.on_load_finish = [&](auto const&) { loaded = true; };
        view.load(url);
        Core::EventLoop::current().spin_until([&] { return loaded || crashed; });
        VERIFY(!crashed);
        view.on_load_finish = nullptr;
        Optional<String> result;
        view.on_console_message = [&](WebView::ConsoleOutput message) {
            if (auto* log = message.output.get_pointer<WebView::ConsoleLog>(); log && log->arguments.size() == 1 && log->arguments[0].is_string()) {
                auto text = log->arguments[0].as_string();
                if (text.bytes_as_string_view().starts_with("GM-BENCH:"sv))
                    std::printf("%s\n", text.to_byte_string().characters());
                if (text.bytes_as_string_view().starts_with("GM-RESULT:"sv)) result = move(text);
            }
        };
        view.start_sending_console_output(true, true);
        view.run_javascript(R"JS((()=>{const poll=()=>{const n=document.documentElement.getAttribute('data-gm-count');if(n===null){setTimeout(poll,5);return}console.log('GM-BENCH:'+document.documentElement.getAttribute('data-gm-benchmark'));console.log('GM-RESULT:'+n+':'+typeof GM)};poll()})())JS"_string);
        Core::EventLoop::current().spin_until([&] { return result.has_value() || crashed; });
        VERIFY(!crashed && result.has_value());
        VERIFY(*result == MUST(String::formatted("GM-RESULT:{}:undefined", expected_count)));
        view.on_console_message = nullptr;
    };
    load(*normal, 1); load(*private_view, 1);
    u64 next_probe = 1;
    auto request = [&](auto& view, Protocol::Request request) -> ErrorOr<Protocol::Response> {
        auto encoded = TRY(Protocol::encode(request));
        auto* test = view.page().client().test_connection();
        VERIFY(test);
        Optional<ErrorOr<ByteBuffer>> response;
        auto probe = next_probe++;
        test->on_derpbird_value_probe = [&](u64 id, bool success, ByteBuffer payload) {
            VERIFY(id == probe);
            if (success) response = move(payload);
            else response = Error::from_string_literal("Provider rejected request");
        };
        test->async_probe_derpbird_values(view.page().id(), probe, false, encoded.bytes());
        Core::EventLoop::current().spin_until([&] { return response.has_value() || crashed; });
        VERIFY(!crashed && response.has_value());
        test->on_derpbird_value_probe = nullptr;
        auto bytes = TRY(response.release_value());
        return Protocol::decode_response(bytes.bytes());
    };
    auto open = [&](auto& view) { return MUST(request(view, { Protocol::Method::Open, true, "one"_string, {}, {} })).token; };
    auto get = [&](auto& view, String const& token) { return request(view, { Protocol::Method::Get, true, token, "u8:key"_string, {} }); };
    auto set = [&](auto& view, String const& token, StringView value) {
        return request(view, { Protocol::Method::Set, true, token, {}, { { "u8:key"_string, MUST(ByteBuffer::copy(value.bytes())) } } });
    };
    auto normal_token = open(*normal);
    auto private_token = open(*private_view);
    auto event_token = MUST(request(*normal, { Protocol::Method::Open, true, "events"_string, {}, {} })).token;
    auto subscription = MUST(request(*normal, { Protocol::Method::Subscribe, true, event_token, "u8:key"_string, {} }));
    VERIFY(subscription.kind == Protocol::Kind::Subscription);
    Vector<NonnullRefPtr<WebView::DerpBirdValueEvents::Reservation>> reservations;
    auto document_id = normal->page().traversable().active_document().id();
    auto& connection = normal->page().client();
    VERIFY(connection.reserve_derpbird_value_event(normal->page().id(), { document_id.namespace_id + 1, document_id.local_id }, 16).is_error());
    for (size_t i = 0; i < WebView::DerpBirdValueEvents::max_pending; ++i)
        reservations.append(MUST(connection.reserve_derpbird_value_event(normal->page().id(), document_id, 1)));
    VERIFY(set(*normal, event_token, "must-not-commit"sv).is_error());
    VERIFY(!MUST(get(*normal, event_token)).value.has_value());
    reservations.clear();
    MUST(set(*normal, event_token, "reserved-delivery"sv));
    VERIFY(StringView(MUST(get(*normal, event_token)).value->bytes()) == "reserved-delivery"sv);
    // The probe token has no live script world. Renderer rejects its event; host
    // removes that subscription. A normal unsubscribe remains safely idempotent.
    MUST(request(*normal, { Protocol::Method::Unsubscribe, true, event_token, subscription.token, {} }));

    MUST(set(*normal, normal_token, "normal"sv));
    VERIFY(!MUST(get(*private_view, private_token)).value.has_value());
    MUST(set(*private_view, private_token, "private"sv));
    VERIFY(StringView(MUST(get(*normal, normal_token)).value->bytes()) == "normal"sv);
    VERIFY(StringView(MUST(get(*private_view, private_token)).value->bytes()) == "private"sv);
    VERIFY(get(*normal, private_token).is_error());
    // Same-URL navigation must revoke the old native document's capability.
    auto navigation_reservation = MUST(connection.reserve_derpbird_value_event(normal->page().id(), document_id, 16));
    load(*normal, 2);
    VERIFY(navigation_reservation->enqueue(MUST(ByteBuffer::create_zeroed(16)), [](auto) { VERIFY_NOT_REACHED(); }).is_error());
    VERIFY(get(*normal, normal_token).is_error());
    normal_token = open(*normal);
    VERIFY(StringView(MUST(get(*normal, normal_token)).value->bytes()) == "normal"sv);
    auto second_normal = WebView::HeadlessWebView::create(theme, { 800, 600 });
    load(*second_normal, 3);
    VERIFY(&second_normal->page().client() != &normal->page().client());
    auto read_events = [&](auto& view) {
        Optional<String> result;
        view.on_console_message = [&](WebView::ConsoleOutput message) {
            if (auto* log = message.output.get_pointer<WebView::ConsoleLog>(); log && log->arguments.size() == 1 && log->arguments[0].is_string()) {
                auto text = log->arguments[0].as_string();
                if (text.bytes_as_string_view().starts_with("CROSS:"sv)) result = move(text);
            }
        };
        view.run_javascript("console.log('CROSS:'+document.documentElement.getAttribute('data-gm-events'))"_string);
        Core::EventLoop::current().spin_until([&] { return result.has_value() || crashed; });
        VERIFY(!crashed && result.has_value());
        view.on_console_message = nullptr;
        return result.release_value();
    };
    VERIFY(read_events(*normal) == R"JSON(CROSS:[["count",1,2,false],["count",2,3,true]])JSON"sv);
    VERIFY(read_events(*second_normal) == R"JSON(CROSS:[["count",2,3,false]])JSON"sv);
    VERIFY(read_events(*private_view) == R"JSON(CROSS:[["count",null,1,false]])JSON"sv);
    MUST(app->set_derpbird_user_scripts(JsonValue { JsonArray {} }));
    VERIFY(get(*normal, normal_token).is_error());
    VERIFY(get(*private_view, private_token).is_error());
    MUST(app->set_derpbird_user_scripts(registry));
    normal_token = open(*normal);
    auto pending_write = MUST(Protocol::encode(Protocol::Request { Protocol::Method::Set, true, normal_token, {}, {
        { "u8:key"_string, MUST(ByteBuffer::copy("drained"sv.bytes())) } } }));
    bool write_replied = false;
    // Enter the same installed provider with a canonical document and immediately
    // request shutdown, before its worker reply can be delivered to the UI.
    app->on_derpbird_value_request(normal->page(), normal->page().traversable().active_document(), move(pending_write), [&](auto result) {
        VERIFY(result.is_error()); // Shutdown revokes reply capability, not accepted persistence.
        write_replied = true;
    });
    bool drained = false, disconnected = false;
    host.shutdown([&] { drained = true; });
    // The Hub receives an explicit app shutdown before the UI connection closes.
    // Both callers must complete after the same accepted write has drained.
    host.shutdown([&] { disconnected = true; });
    Core::EventLoop::current().spin_until([&] { return drained && disconnected; });
    bool already_closed = false;
    host.shutdown([&] { already_closed = true; });
    VERIFY(already_closed);
    VERIFY(write_replied);
    VERIFY(request(*normal, { Protocol::Method::Open, true, "one"_string, {}, {} }).is_error());
    {
        Ladybird::DerpBirdValueHost reopened(*app);
        MUST(app->set_derpbird_user_scripts(registry));
        auto reopened_normal = open(*normal);
        auto reopened_private = open(*private_view);
        VERIFY(StringView(MUST(get(*normal, reopened_normal)).value->bytes()) == "drained"sv);
        VERIFY(!MUST(get(*private_view, reopened_private)).value.has_value());
        bool closed = false;
        reopened.shutdown([&] { closed = true; });
        Core::EventLoop::current().spin_until([&] { return closed; });
    }
    std::puts("Qt value host IPC, profile/private isolation, navigation revocation and shutdown passed");
}
