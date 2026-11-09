#pragma once

#include <LibWebView/CanonicalNavigable.h>
#include <QElapsedTimer>

// Reuse the provider host and HTTP transport used by the runtime integration
// fixture. Inspect canonical hosts: different hostnames alone prove no isolation.
static void verify_script_frame_handoff(WebView::Application& application, Ladybird::DerpBirdValueHost& host, QGuiApplication& qt, String const& base)
{
    auto record = MUST(JsonValue::from_string(R"JSON({
        "id":"frame-handoff","name":"Frame handoff","enabled":true,"fileAccessGranted":false,
        "metadata":{"runAt":"document-start","grantNone":false,"noFrames":false,
        "matches":["http://*/*"],"includes":[],"excludes":[],"excludeMatches":[],
        "grants":["GM.registerMenuCommand"],"requires":[],"resources":[],"connects":[]}
    })JSON"sv)).as_object();
    record.set("source"sv, R"JS(
        if (window===top) addEventListener('message',event=>{
            if(event.data?.fixture==='command')console.log('FRAME:'+event.data.host);
        });
        GM.registerMenuCommand('Frame command',()=>{
            if(window===top)console.log('FRAME:top');
            else parent.postMessage({fixture:'command',host:location.hostname},'*');
        },{clickedFrame:true});
    )JS"sv);
    JsonArray records;
    records.must_append(move(record));
    MUST(application.set_derpbird_user_scripts(JsonValue { move(records) }));
    auto theme = MUST(Gfx::load_system_theme(ByteString::formatted("{}/themes/Default.ini", WebView::s_ladybird_resource_root)));
    auto view = WebView::HeadlessWebView::create(move(theme), {800,600});
    bool crashed = false;
    Optional<String> result;
    view->on_web_content_crashed = [&](auto) { crashed = true; };
    view->on_console_message = [&](WebView::ConsoleOutput message) {
        if (auto* log = message.output.get_pointer<WebView::ConsoleLog>(); log && log->arguments.size()==1 && log->arguments[0].is_string()) {
            auto value = log->arguments[0].as_string();
            if (value.bytes_as_string_view().starts_with("FRAME:"sv)) result = move(value);
        }
    };
    view->on_load_finish = [&](auto const&) { view->start_sending_console_output(true,true); };
    auto wait = [&](auto ready) {
        QElapsedTimer deadline; deadline.start();
        while (!ready() && !crashed && deadline.elapsed()<15000) {
            qt.processEvents();
            qt.sendPostedEvents(nullptr,QEvent::DeferredDelete);
            Core::EventLoop::current().pump(Core::EventLoop::WaitMode::PollForEvents);
            usleep(1000);
        }
        VERIFY(!crashed && ready());
    };
    auto child_document = [&]() -> Optional<Web::HTML::CrossProcessId> {
        Optional<Web::HTML::CrossProcessId> child;
        view->traversable().for_each_in_subtree([&](WebView::CanonicalNavigable& navigable) {
            if (&navigable != &view->traversable() && navigable.active_document().host()) {
                child = navigable.active_document().id();
                return IterationDecision::Break;
            }
            return IterationDecision::Continue;
        });
        return child;
    };
    view->load(*URL::Parser::basic_parse(MUST(String::formatted("{}/frame-top",base))));
    wait([&] { auto child=child_document(); return child.has_value() && host.commands.list(view->page(),child).size()==1 && host.commands.list(view->page()).size()==1; });
    auto original = child_document().value();
    bool separate = false;
    view->traversable().for_each_in_subtree([&](WebView::CanonicalNavigable& navigable) {
        auto const& document = navigable.active_document();
        if (document.id()==original) separate = &document.host()->client()!=&view->page().client();
        return IterationDecision::Continue;
    });
    VERIFY(separate);
    auto command = host.commands.list(view->page(),original).at(0).as_object().get_string("id"sv).value();
    JsonObject event; event.set("keyboard"sv,false);
    VERIFY(host.commands.invoke(view->page(),command,event).is_error());
    MUST(host.commands.invoke(view->page(),command,event,original));
    wait([&] { return result.has_value(); });
    VERIFY(*result=="FRAME:localhost"sv);
    result.clear();
    view->run_javascript(MUST(String::formatted("document.querySelector('iframe').src='{}/frame-child?new'",base)));
    wait([&] { auto child=child_document(); return child.has_value() && *child!=original && host.commands.list(view->page(),child).size()==1; });
    auto replacement = child_document().value();
    VERIFY(host.commands.list(view->page(),original).is_empty());
    VERIFY(host.commands.invoke(view->page(),command,event,original).is_error());
    auto fresh = host.commands.list(view->page(),replacement).at(0).as_object().get_string("id"sv).value();
    MUST(host.commands.invoke(view->page(),fresh,event,replacement));
    wait([&] { return result.has_value(); });
    VERIFY(*result=="FRAME:127.0.0.1"sv);
    MUST(application.set_derpbird_user_scripts(JsonValue { JsonArray {} }));
    VERIFY(host.commands.list(view->page(),replacement).is_empty());
    VERIFY(host.commands.invoke(view->page(),fresh,event,replacement).is_error());
    view->on_load_finish = nullptr;
    view->on_console_message = nullptr;
    view->on_web_content_crashed = nullptr;
    puts("Cross-process clicked-frame commands, navigation handoff and revocation passed");
}
