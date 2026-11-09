#include "HeadlessTest.h"
#include <AK/JsonObject.h>
#include <AK/LexicalPath.h>
#include <DerpBirdFilePicker.h>
#include <LibCore/EventLoop.h>
#include <LibGfx/SystemTheme.h>
#include <LibURL/Parser.h>
#include <LibWebCommon/Page/InputEvent.h>
#include <LibWebCommon/WebView/ConsoleOutput.h>
#include <LibWebView/HeadlessWebView.h>
#include <QApplication>
#include <QElapsedTimer>
#include <QFile>
#include <QTemporaryDir>
#include <unistd.h>

int main(int argc, char** argv)
{
    QApplication::setAttribute(Qt::AA_DontUseNativeDialogs);
    QApplication qt(argc, argv);
    QTemporaryDir directory;
    QFile backup(directory.filePath("ZeroOmegaOptions.bak"));
    VERIFY(backup.open(QIODevice::WriteOnly));
    backup.write(
        R"({"schemaVersion":2,"+proxy":{"name":"proxy","profileType":"FixedProfile","fallbackProxy":{"scheme":"http","host":"127.0.0.1","port":8080}}})");
    backup.close();
    Test::HeadlessTestEnvironment environment { "DerpBirdFilePicker"sv };
    auto application = MUST(environment.create_application());
    auto theme = MUST(Gfx::load_system_theme(
        LexicalPath::join(WebView::s_ladybird_resource_root, "themes"sv,
            "Default.ini"sv)
            .string()));
    auto view = WebView::HeadlessWebView::create(move(theme), { 1200, 900 });
    bool loaded = false;
    view->on_load_finish = [&](auto const&) { loaded = true; };
    Core::EventLoop::current().spin_until([&] { return loaded; });
    QWidget parent;
    Ladybird::DerpBirdFilePicker picker(&parent);
    size_t opened = 0;
    bool mounted = false;
    view->on_request_file_picker = [&](auto const& types, auto multiple) {
        ++opened;
        picker.open(types, multiple,
            [&](auto files) { view->file_picker_closed(move(files)); });
    };
    view->on_derpbird_request = [&](JsonValue const& request, auto completion) {
        auto type = request.as_object().get_string("type"sv).value_or(String {});
        if (type == "command"sv)
            mounted = true;
        auto result = type == "snapshot"sv
            ? R"({"version":1,"revision":1,"tabs":[],"activeTabId":null,"preferences":{"layout":"vertical","compact":false}})"sv
            : type == "proxy.get"sv
            ? R"({"revision":0,"active":"direct","options":{"schemaVersion":2}})"sv
            : type == "import.status"sv ? R"({"welcome":false,"profiles":[]})"sv
            : type.bytes_as_string_view().ends_with(".folders"sv)
            ? R"({"directories":[],"files":[]})"sv
            : type.bytes_as_string_view().ends_with(".list"sv)
            ? R"({"revision":0,"items":[]})"sv
            : "null"sv;
        Core::deferred_invoke([completion = move(completion), result]() mutable {
            completion(JsonValue::from_string(result));
        });
    };
    bool ready = false, passed = false;
    view->on_console_message = [&](WebView::ConsoleOutput message) {
        if (auto* error = message.output.get_pointer<WebView::ConsoleError>())
            warnln("JS: {}", error->message);
        auto* log = message.output.get_pointer<WebView::ConsoleLog>();
        if (!log || log->arguments.size() != 1 || !log->arguments[0].is_string())
            return;
        auto text = log->arguments[0].as_string();
        if (text == "READY"sv)
            ready = true;
        if (text == "PASS"sv)
            passed = true;
        if (text.bytes_as_string_view().starts_with("CLICK:"sv)) {
            auto coordinates = text.bytes_as_string_view().substring_view(6).split_view(',');
            Web::DevicePixelPoint point { coordinates[0].to_number<int>().value(),
                coordinates[1].to_number<int>().value() };
            view->enqueue_input_event(
                Web::MouseEvent { .type = Web::MouseEvent::Type::MouseDown,
                    .position = point,
                    .screen_position = point,
                    .button = Web::UIEvents::MouseButton::Primary,
                    .buttons = Web::UIEvents::MouseButton::Primary,
                    .click_count = 1 });
            view->enqueue_input_event(
                Web::MouseEvent { .type = Web::MouseEvent::Type::MouseUp,
                    .position = point,
                    .screen_position = point,
                    .button = Web::UIEvents::MouseButton::Primary,
                    .click_count = 1 });
        }
    };
    view->start_sending_console_output(true, true);
    view->load(URL::Parser::basic_parse("about:derpbird"sv).release_value());
    auto wait = [&](auto condition) {
        QElapsedTimer timer;
        timer.start();
        while (!condition()) {
            qt.processEvents();
            Core::EventLoop::current().pump(Core::EventLoop::WaitMode::PollForEvents);
            VERIFY(timer.elapsed() < 15000);
            usleep(1000);
        }
    };
    wait([&] { return mounted; });
    view->start_sending_console_output(true, true);
    view->run_javascript(R"JS((async()=>{
          const wait=async f=>{while(!f())await new Promise(r=>setTimeout(r,20))};
          await wait(()=>document.querySelector('[aria-label="Proxy switcher"]'));
          document.querySelector('[aria-label="Proxy switcher"]').click();
          await wait(()=>document.querySelector('.proxy-popup-settings:not(:disabled)'));
          document.querySelector('.proxy-popup-settings').click();
          await wait(()=>document.querySelector('.proxy-empty'));
          window.clickImport=()=>{const b=[...document.querySelectorAll('.proxy-manager button')].find(b=>b.textContent==='Import backup').getBoundingClientRect();console.log('CLICK:'+Math.round(b.x+b.width/2)+','+Math.round(b.y+b.height/2))};
          console.log('READY');
          await wait(()=>document.querySelector('[role="status"]')?.textContent.includes('Imported '));
          console.log('PASS');
        })())JS"_string);
    wait([&] { return ready; });
    auto open = [&] {
        view->run_javascript("clickImport()"_string);
        wait([&] {
            return parent.findChild<QFileDialog*>() && parent.findChild<QFileDialog*>()->isVisible();
        });
        auto* dialog = parent.findChild<QFileDialog*>();
        VERIFY(dialog->fileMode() == QFileDialog::ExistingFile);
        VERIFY(dialog->nameFilters().join(' ').contains("*.bak"));
        VERIFY(dialog->nameFilters().join(' ').contains("*.json"));
        return dialog;
    };
    auto* first = open();
    first->reject();
    qt.sendPostedEvents(nullptr, QEvent::DeferredDelete);
    open();
    picker.cancel();
    qt.sendPostedEvents(nullptr, QEvent::DeferredDelete);
    auto* second = open();
    second->selectFile(argc > 1 ? QString::fromLocal8Bit(argv[1])
                                : backup.fileName());
    VERIFY(QMetaObject::invokeMethod(second, "accept", Qt::DirectConnection));
    wait([&] { return passed; });
    VERIFY(opened == 3);
    outln("PASS: real shell click opens Qt file dialog; cancel/reopen and "
          "selected backup import");
    return 0;
}
