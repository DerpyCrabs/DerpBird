#include <DerpBirdScriptInstall.h>
#include <DerpBirdSourceTask.h>
#include <QHash>
#include <DerpBirdNetworkRequest.h>
#include <DerpBirdValueHost.h>
#include <LibGfx/SystemTheme.h>
#include <LibWebView/HeadlessWebView.h>
#include <LibWebView/Utilities.h>
#include <LibWebView/RecordingNotificationBackend.h>
#include <LibWebCommon/WebView/ConsoleOutput.h>
#include <DerpBirdScriptStore.h>
#include "HeadlessTest.h"
#include <LibCore/Socket.h>
#include <LibCore/TCPServer.h>
#include <QGuiApplication>
#include <QClipboard>
#include <QMimeData>
#include <QEvent>
#include <QTemporaryDir>
#include <memory>
#include <unistd.h>

#include "script-frame-handoff.h"

int main(int argc, char** argv)
{
    QTemporaryDir download_directory;
    VERIFY(download_directory.isValid());
    qputenv("XDG_DOWNLOAD_DIR", download_directory.path().toUtf8());
    QGuiApplication qt(argc, argv);
    Test::HeadlessTestEnvironment environment { "DerpBirdDependencyInstall"sv };
    auto application = MUST(environment.create_application());
    auto server = MUST(Core::TCPServer::try_create());
    MUST(server->listen(IPv4Address { 127, 0, 0, 1 }, 0));
    size_t requests = 0;
    Vector<NonnullOwnPtr<Core::TCPSocket>> sockets;
    server->on_ready_to_accept = [&] {
        sockets.append(MUST(server->accept()));
        auto& socket = *sockets.last();
        MUST(socket.set_blocking(false));
        auto received = std::make_shared<ByteBuffer>();
        socket.on_ready_to_read = [&socket, &requests, &server, received] {
            u8 buffer[8192];
            auto bytes = MUST(socket.read_some(buffer));
            if (bytes.is_empty()) return;
            MUST(received->try_append(bytes));
            VERIFY(received->size() <= 65536);
            auto complete_request = received;
            StringView request { complete_request->bytes() };
            auto header_end = request.find("\r\n\r\n"sv);
            if (!header_end.has_value()) return;
            bool options_body = request.starts_with("OPTIONS /echo-body "sv);
            if (options_body) {
                VERIFY(request.contains("Content-Length: 7\r\n"sv));
                if (request.length() < *header_end + 4 + 7) return;
                VERIFY(request.substring_view(*header_end + 4) == "payload"sv);
            }
            ++requests;
            VERIFY(!request.contains("Cookie:"sv));
            bool header_download = request.starts_with("GET /headers "sv) || request.starts_with("GET /download-redirect "sv) || request.starts_with("GET /download-cross "sv);
            if (header_download) {
                VERIFY(request.contains("Authorization: Bearer fixture"sv));
                VERIFY(request.contains("X-Download: test"sv));
            } else VERIFY(!request.contains("Authorization:"sv));
            socket.on_ready_to_read = nullptr;
            if (request.starts_with("GET /hang "sv)) return;
            bool idle_stream = request.starts_with("GET /idle-stream "sv);
            if (idle_stream || request.starts_with("GET /slow-headers "sv)) {
                if (idle_stream)
                    MUST(socket.write_until_depleted("HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\n"sv.bytes()));
                QTimer::singleShot(31000, [&socket, idle_stream] {
                    auto response = idle_stream ? "slow"sv : "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\nslow"sv;
                    auto written = socket.write_until_depleted(response.bytes());
                    VERIFY(!written.is_error());
                    socket.close();
                });
                return;
            }
            if (request.starts_with("GET /frame-top "sv) || request.starts_with("GET /frame-child"sv)) {
                auto body = request.starts_with("GET /frame-top "sv)
                    ? ByteString::formatted("<!doctype html><iframe src='http://localhost:{}/frame-child'></iframe>", *server->local_port())
                    : ByteString("<!doctype html><h1>Cross-process frame</h1>");
                auto response = ByteString::formatted("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.length(),body);
                MUST(socket.write_until_depleted(response.bytes()));
            } else if (options_body) {
                MUST(socket.write_until_depleted("HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\npayload"sv.bytes()));
            } else if (request.starts_with("GET /download-redirect "sv) || request.starts_with("GET /download-cross "sv)) {
                auto location = request.starts_with("GET /download-cross "sv)
                    ? ByteString::formatted("http://localhost:{}/two", *server->local_port()) : ByteString("/headers");
                auto response = ByteString::formatted("HTTP/1.1 302 Found\r\nLocation: {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", location);
                MUST(socket.write_until_depleted(response.bytes()));
            } else if (request.starts_with("GET /redirect "sv)) {
                MUST(socket.write_until_depleted("HTTP/1.1 302 Found\r\nLocation: /one\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"sv.bytes()));
            } else {
                auto status = request.starts_with("GET /missing "sv) ? "404 Not Found"sv : "200 OK"sv;
                auto body = request.starts_with("GET / HTTP/"sv) ? "<!doctype html><meta charset=utf-8><h1>Runtime fixture</h1>"sv : request.starts_with("GET /two "sv) ? "library.push(2);"sv : "var library = [1];"sv;
                auto response = ByteString::formatted("HTTP/1.1 {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", status, body.length(), body);
                MUST(socket.write_until_depleted(response.bytes()));
            }
            socket.close();
        };
    };
    auto base = MUST(String::formatted("http://127.0.0.1:{}", *server->local_port()));
    auto records = MUST(JsonValue::from_string(R"JSON([{
        "id":"test","name":"dependencies","source":"library.push(3)","enabled":true,"fileAccessGranted":false,
        "metadata":{"runAt":"document-start","grantNone":false,"noFrames":false,"matches":["http://*/*"],
        "includes":[],"excludes":[],"excludeMatches":[],"grants":[],"requires":[],"resources":[],"connects":[]}
    }])JSON"sv)).as_array();
    auto with_urls = [&](JsonArray urls) {
        auto items = records;
        auto metadata = items.values()[0].as_object().get_object("metadata"sv).value();
        metadata.set("requires"sv, move(urls));
        items.values()[0].as_object().set("metadata"sv, move(metadata));
        return items;
    };
    QHash<u64, QPointer<Ladybird::DerpBirdSourceTask>> dependency_requests;
    u64 next_dependency_request = 1;
    auto dependency_transport = [&]() -> Ladybird::DerpBirdScriptInstall::Transport {
        return {
            .request = [&](JsonValue payload, Function<void(ErrorOr<JsonValue>)> completion) {
                auto id = next_dependency_request++;
                auto url = URL::Parser::basic_parse(*payload.as_object().get_string("url"sv));
                VERIFY(url.has_value());
                auto* task = new Ladybird::DerpBirdSourceTask(nullptr, *url, *payload.as_object().get_integer<size_t>("limit"sv), true,
                    [&, id, completion = move(completion)](auto response) mutable {
                        dependency_requests.remove(id);
                        completion(move(response));
                    });
                dependency_requests.insert(id, task);
                task->start();
                return id;
            },
            .cancel = [&](u64 id) { delete dependency_requests.take(id).data(); },
        };
    };
    auto install = [&](JsonArray items, QString const& folder_config = {}) -> ErrorOr<JsonArray> {
        Optional<ErrorOr<JsonArray>> result;
        auto* task = new Ladybird::DerpBirdScriptInstall(nullptr, move(items), [&](auto value) {
            VERIFY(QThread::currentThread() == qt.thread());
            result = move(value);
        }, dependency_transport(), folder_config);
        task->start();
        if (!folder_config.isEmpty()) VERIFY(!result.has_value());
        while (!result.has_value()) {
            qt.processEvents();
        qt.sendPostedEvents(nullptr, QEvent::DeferredDelete);
            Core::EventLoop::current().pump(Core::EventLoop::WaitMode::PollForEvents);
            usleep(1000);
        }
        qt.sendPostedEvents(nullptr, QEvent::DeferredDelete);
        return result.release_value();
    };
    // Local dependencies use only registered roots, preserve binary resources,
    // and participate in the same atomic install transaction as HTTP sources.
    {
    QTemporaryDir local_root;
    VERIFY(local_root.isValid());
    auto write_local = [&](QString const& name, QByteArray const& bytes) {
        QFile file(local_root.filePath(name));
        VERIFY(file.open(QIODevice::WriteOnly));
        VERIFY(file.write(bytes) == bytes.size());
    };
    write_local("main.user.js", "// ==UserScript==\n// @name local\n// ==/UserScript==");
    write_local("library.js", "var localLibrary = 42;");
    write_local("resource.bin", QByteArray("a\0b", 3));
    auto config_path = local_root.filePath("directories.json");
    write_local("directories.json", QJsonDocument(QJsonArray { local_root.path() }).toJson());
    auto local_id = "folder_" + QString::fromLatin1(QCryptographicHash::hash(QFileInfo(local_root.filePath("main.user.js")).canonicalFilePath().toUtf8(), QCryptographicHash::Sha256).toHex());
    JsonArray local_urls;
    local_urls.must_append("./library.js"_string);
    auto local_items = with_urls(local_urls);
    auto& local_record = local_items.values()[0].as_object();
    local_record.set("id"sv, Ladybird::derpbird_dependency_string(local_id));
    auto local_meta = local_record.get_object("metadata"sv).value();
    JsonArray local_resources;
    JsonObject resource;
    resource.set("name"sv, "binary"sv);
    resource.set("url"sv, "./resource.bin"sv);
    local_resources.must_append(move(resource));
    local_meta.set("resources"sv, move(local_resources));
    local_record.set("metadata"sv, move(local_meta));
    auto cancelled_completions = std::make_shared<size_t>(0);
    auto* cancelled = new Ladybird::DerpBirdScriptInstall(nullptr, local_items,
        [cancelled_completions](auto value) {
            ++*cancelled_completions;
            VERIFY(value.is_error());
        }, dependency_transport(), config_path);
    cancelled->start();
    VERIFY(*cancelled_completions == 0);
    delete cancelled;
    VERIFY(*cancelled_completions == 1);
    auto local_result = MUST(install(local_items, config_path));
    VERIFY(*cancelled_completions == 1);
    VERIFY(requests == 0);
    VERIFY(local_result.values()[0].as_object().get_array("requiredSources"sv)->at(0).as_object().get_string("source"sv) == "var localLibrary = 42;"sv);
    VERIFY(local_result.values()[0].as_object().get_array("cachedResources"sv)->at(0).as_object().get_string("dataUrl"sv)->bytes_as_string_view().ends_with("YQBi"sv));
    auto local_authority = MUST(Ladybird::derpbird_local_script(config_path, local_id));
    VERIFY(Ladybird::derpbird_read_local_dependency(local_authority, "../outside.js").is_error());
    VERIFY(Ladybird::derpbird_read_local_dependency(local_authority, "file:///etc/passwd").is_error());
    VERIFY(Ladybird::derpbird_read_local_dependency(local_authority, "%2fetc/passwd").is_error());
    QTemporaryDir outside_root;
    VERIFY(outside_root.isValid());
    QFile outside(outside_root.filePath("outside.js"));
    VERIFY(outside.open(QIODevice::WriteOnly));
    VERIFY(outside.write("outside") == 7);
    outside.close();
    VERIFY(QFile::link(outside.fileName(), local_root.filePath("escape.js")));
    VERIFY(Ladybird::derpbird_read_local_dependency(local_authority, "./escape.js").is_error());
    VERIFY(install(local_items).is_error());
    VERIFY(Ladybird::verify_derpbird_dependency_fragment("sha256=wrong"sv, "test"sv.bytes()).is_error());
    }
    JsonArray urls;
    urls.must_append(MUST(String::formatted("{}/redirect", base)));
    urls.must_append(MUST(String::formatted("{}/two", base)));
    auto installed = MUST(install(with_urls(urls)));
    VERIFY(requests == 3);
    auto sources = installed.at(0).as_object().get_array("requiredSources"sv).value();
    VERIFY(sources.size() == 2);
    VERIFY(sources.at(0).as_object().get_string("source"sv) == "var library = [1];"sv);
    VERIFY(sources.at(1).as_object().get_string("source"sv) == "library.push(2);"sv);
    QTemporaryDir directory;
    Ladybird::DerpBirdScriptStore store(directory.path() + "/scripts.json");
    MUST(store.replace(installed, 0));
    // The editor never returns native source caches; unchanged code reuses them.
    MUST(install(MUST(store.prepare_from_editor(with_urls(urls), 1))));
    VERIFY(requests == 3);
    auto original = JsonValue(store.items()).serialized();
    for (auto path : { "/missing"sv, "/one#sha256=wrong"sv }) {
        JsonArray invalid;
        invalid.must_append(MUST(String::formatted("{}{}", base, path)));
        VERIFY(install(MUST(store.prepare_from_editor(with_urls(invalid), 1))).is_error());
        VERIFY(store.revision() == 1 && JsonValue(store.items()).serialized() == original);
    }
    auto body = "var library = [1];"sv;
    auto digest = QCryptographicHash::hash(QByteArrayView(body.characters_without_null_termination(), body.length()), QCryptographicHash::Sha256);
    for (auto encoded : { digest.toHex(), digest.toBase64() }) {
        auto address = MUST(String::formatted("{}/one#md5=wrong;sha256={}", base, StringView(encoded.data(), encoded.size())));
        MUST(Ladybird::verify_derpbird_dependency(address, body.bytes()));
        JsonArray valid;
        valid.must_append(address);
        MUST(install(with_urls(valid)));
    }
    VERIFY(Ladybird::verify_derpbird_dependency("file:///tmp/code.js"sv, body.bytes()).is_error());
    VERIFY(Ladybird::verify_derpbird_dependency("https://user:pass@example.com/a"sv, body.bytes()).is_error());
    VERIFY(Ladybird::verify_derpbird_dependency("https://example.com/a#sha256=wrong"sv, body.bytes()).is_error());
    auto resource_items = with_urls(urls);
    auto resource_meta = resource_items.values()[0].as_object().get_object("metadata"sv).value();
    JsonArray resource_urls;
    JsonObject resource;
    resource.set("name"sv, "__proto__"sv);
    resource.set("url"sv, MUST(String::formatted("{}/two", base)));
    resource_urls.must_append(move(resource));
    resource_meta.set("resources"sv, move(resource_urls));
    resource_items.values()[0].as_object().set("metadata"sv, move(resource_meta));
    auto cached_resources = MUST(install(resource_items));
    auto cached_resource = cached_resources.at(0).as_object().get_array("cachedResources"sv)->at(0).as_object();
    VERIFY(cached_resource.get_string("name"sv) == "__proto__"sv);
    VERIFY(cached_resource.get_string("text"sv) == "library.push(2);"sv);
    VERIFY(cached_resource.get_string("dataUrl"sv)->bytes_as_string_view().starts_with("data:application/octet-stream;base64,"sv));
    MUST(store.replace(cached_resources, 1));
    auto kept = MUST(store.prepare_from_editor(resource_items, 2));
    VERIFY(kept.at(0).as_object().has("cachedResources"sv));

    auto network = [&](StringView path, u32 timeout = 1000, bool options_body = false) -> ErrorOr<JsonValue> {
        Optional<ErrorOr<ByteBuffer>> result;
        JsonObject options;
        options.set("url"sv, MUST(String::formatted("{}{}", base, path)));
        options.set("anonymous"sv, true);
        options.set("timeout"sv, timeout);
        if (options_body) {
            options.set("method"sv, "OPTIONS"sv);
            options.set("body"sv, "cGF5bG9hZA=="sv);
        }
        auto request = options.serialized();
        auto* task = new Ladybird::DerpBirdNetworkRequest(nullptr, {}, *URL::Parser::basic_parse(base), WebView::IsPrivate::No,
            [] { return true; }, [&](auto value) { result = move(value); });
        auto started = task->start(request.bytes());
        if (started.is_error()) { delete task; return started.release_error(); }
        while (!result.has_value()) {
            qt.processEvents();
        qt.sendPostedEvents(nullptr, QEvent::DeferredDelete);
            Core::EventLoop::current().pump(Core::EventLoop::WaitMode::PollForEvents);
            usleep(1000);
        }
        qt.sendPostedEvents(nullptr, QEvent::DeferredDelete);
        auto packet = TRY(result.release_value());
        auto response = TRY(Web::DerpBirdValueProtocol::decode_response(packet.bytes()));
        VERIFY(response.kind == Web::DerpBirdValueProtocol::Kind::Network);
        return JsonValue::from_string(StringView { response.value->bytes() });
    };
    auto fetched = MUST(network("/redirect"sv)).as_object();
    VERIFY(fetched.get_string("event"sv) == "load"sv && fetched.get_integer<int>("status"sv) == 200);
    VERIFY(MUST(network("/missing"sv)).as_object().get_integer<int>("status"sv) == 404);
    VERIFY(MUST(network("/hang"sv, 20)).as_object().get_string("event"sv) == "timeout"sv);
    auto echoed = MUST(network("/echo-body"sv, 1000, true)).as_object();
    VERIFY(echoed.get_string("event"sv) == "load"sv && echoed.get_integer<int>("status"sv) == 200);
    VERIFY(echoed.get_string("body"sv) == "cGF5bG9hZA=="sv);
    auto denied = new Ladybird::DerpBirdNetworkRequest(nullptr, {}, *URL::Parser::basic_parse("https://different.example/"sv), WebView::IsPrivate::No,
        [] { return true; }, [](auto) { VERIFY_NOT_REACHED(); });
    JsonObject denied_options;
    denied_options.set("url"sv, base);
    auto denied_payload = denied_options.serialized();
    VERIFY(denied->start(denied_payload.bytes()).is_error());
    delete denied;
    Ladybird::DerpBirdValueHost host(*application);
    WebView::RecordingNotificationBackend* notification_backend=nullptr;
    host.notifications.create_backend=[&]()->NonnullOwnPtr<WebView::NotificationBackend>{auto backend=make<WebView::RecordingNotificationBackend>();notification_backend=backend.ptr();return backend;};
    unsigned notification_highlights=0;
    host.notifications.highlight=[&](WebView::WebContentPage&){++notification_highlights;};
    Vector<String> notification_urls;
    host.notifications.open_url=[&](WebView::WebContentPage&,URL::URL const& url){notification_urls.append(url.serialize());};
    bool decoded_image=false, fallback_image=false;
    QTimer notification_actions;
    QObject::connect(&notification_actions,&QTimer::timeout,&qt,[&]{
        if(!notification_backend)return;
        auto shown=notification_backend->shown();
        for(auto const& item:shown){
            if(item.data.title=="Image decoded"_utf16){VERIFY(item.icon && item.icon->width()==1 && item.icon->height()==1);decoded_image=true;}
            if(item.data.title=="Image fallback"_utf16){VERIFY(!item.icon);fallback_image=true;}
        }
        for(auto const& item:shown)if(item.data.title=="Modern click"_utf16||item.data.title=="Legacy click"_utf16||item.data.title=="URL click"_utf16||item.data.title=="Prevent URL"_utf16){
            VERIFY(item.data.silent.value_or(false));notification_backend->click(item.id);
        }
    });
    notification_actions.start(10);
    size_t pickers=0;
    host.downloads.choose_path=[&](ByteString const& name){
        ++pickers;
        auto promise=Core::Promise<LexicalPath>::construct();
        auto filename=QString::fromUtf8(name.characters());
        auto path=download_directory.filePath(filename).toUtf8();
        auto destination=LexicalPath(ByteString(path.constData(),path.size()));
        QTimer::singleShot(60,&qt,[promise,destination]{promise->resolve(destination);});
        return promise;
    };
    Vector<QPointer<QObject>> script_tabs;
    host.tabs.on_open = [&](WebView::WebContentPage&, URL::URL const& url, JsonObject const& options) -> ErrorOr<Ladybird::DerpBirdScriptTabs::Handle> {
        VERIFY(url.scheme() == "http"sv && options.get_bool("active"sv).has_value());
        auto* tab = new QObject(&qt);
        script_tabs.append(QPointer<QObject> { tab });
        return Ladybird::DerpBirdScriptTabs::Handle { QPointer<QObject> { tab }, [tab = QPointer(tab)] { if (tab) tab->deleteLater(); } };
    };
    auto& runtime_record = cached_resources.values()[0].as_object();
    auto runtime_meta = runtime_record.get_object("metadata"sv).value();
    runtime_meta.set("grants"sv, MUST(JsonValue::from_string(R"JSON(["GM.cookie","GM_cookie","GM.notification","GM_notification","GM.download","GM_download","GM_getTab","GM.getTab","GM_saveTab","GM.saveTab","GM_getTabs","GM.getTabs","GM_getValue","GM_setValue","GM_deleteValue","GM_listValues","GM_getValues","GM_setValues","GM_deleteValues","GM_addValueChangeListener","GM_removeValueChangeListener","GM.getValue","GM.setValue","GM.xmlHttpRequest","GM_xmlhttpRequest","GM.getResourceText","GM_getResourceURL","GM.setClipboard","GM_setClipboard","GM_addElement","GM.addElement","GM_log","GM.log","GM.openInTab","GM_openInTab","GM.registerMenuCommand","GM_registerMenuCommand","GM.unregisterMenuCommand","GM_unregisterMenuCommand"])JSON"sv)));
    runtime_record.set("metadata"sv, move(runtime_meta));
    runtime_record.set("source"sv, R"JS(
        (async()=>{
            console.log('STAGE:runtime-start');
            let syncLoaded=false;
            const syncResult=GM_xmlhttpRequest({url:'/one',synchronous:true,anonymous:true,onload:value=>{syncLoaded=value.status===200;}});
            if(!syncLoaded||syncResult.status!==200||!syncResult.responseText.includes('library'))throw Error('synchronous XHR');
            let streamLoaded=false;
            const streamed=await GM.xmlHttpRequest({url:'/one',anonymous:true,responseType:'stream',onload:()=>{streamLoaded=true;}});
            if(!(streamed.response instanceof ReadableStream))throw Error('missing response stream');
            const reader=streamed.response.getReader();let streamedText='';
            for(;;){const part=await reader.read();if(part.done)break;streamedText+=new TextDecoder().decode(part.value);}
            if(!streamLoaded||!streamedText.includes('library'))throw Error('response stream body/completion');


            await GM.cookie.set({name:'gm-cookie-fixture',value:'modern',path:'/'});
            const cookies=await GM.cookie.list({name:'gm-cookie-fixture'});
            if(cookies.length!==1||cookies[0].value!=='modern'||!cookies[0].hostOnly||!cookies[0].session)throw Error('cookie set/list');
            await new Promise((resolve,reject)=>GM_cookie.set({name:'gm-cookie-fixture',value:'legacy',path:'/'},error=>error?reject(Error(error)):resolve()));
            await new Promise((resolve,reject)=>GM_cookie.list({name:'gm-cookie-fixture'},(values,error)=>error||values[0]?.value!=='legacy'?reject(Error('legacy cookie list')):resolve()));
            let cookieDenied=false;try{await GM.cookie.list({url:'https://unmatched.invalid/'});}catch{cookieDenied=true;}if(!cookieDenied)throw Error('cookie match permission');
            await GM.cookie.delete({name:'gm-cookie-fixture'});
            if((await GM.cookie.list({name:'gm-cookie-fixture'})).length)throw Error('cookie delete');

            const initialTab=await GM.getTab();
            if(Object.keys(initialTab).length)throw Error('initial tab data');
            const emptyTabs=await GM.getTabs();
            if(Object.values(emptyTabs).length!==1||Object.keys(Object.values(emptyTabs)[0]).length)throw Error('empty tab enumeration');
            const tabState={message:'tab Привет',count:1};tabState.self=tabState;
            await GM.saveTab(tabState);
            const copy=await GM.getTab();
            if(copy===tabState||copy.self!==copy||copy.message!==tabState.message)throw Error('tab data roundtrip');
            copy.count=99;
            if((await GM.getTab()).count!==1)throw Error('unsaved tab mutation');
            const legacyCopy=await new Promise(resolve=>GM_getTab(resolve));
            if(legacyCopy.count!==1)throw Error('legacy tab read');
            legacyCopy.count=2;
            await new Promise(resolve=>GM_saveTab(legacyCopy,resolve));
            const allTabs=await new Promise(resolve=>GM_getTabs(resolve));
            if(Object.values(allTabs).length!==1||Object.values(allTabs)[0].count!==2)throw Error('legacy tab enumeration');
            let tabRejected=false;try{await GM.saveTab(null);}catch{tabRejected=true;}
            if(!tabRejected)throw Error('tab data validation');
            if(typeof GM.__getTabLegacy!=='undefined')throw Error('tab private binding');
            let microtaskRan=false;
            queueMicrotask(()=>{microtaskRan=true;});
            const fallback={get then(){throw Error('sync default must not be assimilated');}};
            if(GM_getValue('missing',fallback)!==fallback)throw Error('sync default identity');
            const graph={value:'Привет', undef:undefined, nan:NaN};graph.self=graph;
            if(GM_setValue('sync',graph)!==undefined)throw Error('sync write return');
            const restored=GM_getValue('sync');
            if(restored.self!==restored||restored.value!=='Привет'||!Number.isNaN(restored.nan)||!('undef' in restored))throw Error('sync structured value');
            if(!GM_listValues().includes('sync'))throw Error('sync keys');
            GM_setValues({one:1,two:2});
            const selected=GM_getValues({one:0,missing:3});
            if(selected.one!==1||selected.missing!==3||Object.keys(GM_getValues([])).length)throw Error('sync selection');
            if(GM_getValues(['two']).two!==2)throw Error('sync array selection');
            GM_deleteValues(['one','two']);GM_deleteValue('sync');
            if(GM_listValues().includes('one')||GM_getValue('sync','gone')!=='gone')throw Error('sync deletion');
            let rejected=false;try{GM_setValue('function',()=>{});}catch{rejected=true;}
            if(!rejected)throw Error('sync serialization exception');
            let notified=false;
            let completeNotification;const notification=new Promise(resolve=>completeNotification=resolve);
            const listener=GM_addValueChangeListener('watched',(key,oldValue,newValue,remote)=>{
                if(key!=='watched'||oldValue!==undefined||newValue!==42||remote)throw Error('sync listener payload');
                notified=true;completeNotification();
            });
            if(typeof listener!=='number')throw Error('sync listener ID');
            GM_setValue('watched',42);
            if(microtaskRan||notified)throw Error('author callback ran inside sync operation');
            await notification;
            GM_removeValueChangeListener(listener);
            GM_deleteValue('watched');
            const write=GM.setValue('ordered',7);
            if(GM_getValue('ordered')!==7)throw Error('async write before sync read');
            await write;
            GM_setValue('ordered',8);
            if(await GM.getValue('ordered')!==8)throw Error('sync write before async read');
            GM_deleteValue('ordered');
            console.log('STAGE:sync-values');
            if (library.join(',') !== '1,2') throw Error('required library scope');
            if (await GM.getResourceText('__proto__') !== 'library.push(2);') throw Error('resource text');
            if (!GM_getResourceURL('__proto__').startsWith('data:')) throw Error('resource URL');
            const added=GM_addElement(document.documentElement,'span',{id:'gm-element',textContent:'Injected', 'data-test':'yes'});
            if (!(added instanceof HTMLSpanElement) || added.textContent!=='Injected' || added.dataset.test!=='yes') throw Error('addElement legacy');
            const modern=await GM.addElement(added,'b',{textContent:'child'});
            if(modern.parentNode!==added || modern.textContent!=='child') throw Error('addElement modern');
            if(GM_addElement(added,'invalid tag')!==null) throw Error('addElement error');
            GM_log('Utility legacy log'); GM.log('Utility modern log');
            await GM.setClipboard('clipboard plain Привет',{type:'text',mimetype:'text/plain'});
            let invalid=false; try { await GM.setClipboard('invalid','image/png'); } catch {invalid=true;}
            if(!invalid) throw Error('clipboard type validation');
            await new Promise(resolve=>GM_setClipboard('<b>clipboard HTML Привет</b>',{type:'html'},resolve));
            if(typeof GM.__clipboard!=='undefined'||typeof GM.__clipboardLegacy!=='undefined') throw Error('private clipboard bindings');
            let downloadLoaded=0;
            const downloaded=await GM.download({url:'/two',name:'modern.txt',onload:()=>downloadLoaded++});
            if(downloaded.status!=='completed'||downloadLoaded!==1||downloaded.loaded!==16)throw Error('modern download completion');
            await new Promise((resolve,reject)=>{
                const handle=GM_download({url:'/one',name:'legacy.txt',onload:resolve,onerror:reject});
                if(handle instanceof Promise||typeof handle.abort!=='function')reject(Error('legacy download handle'));
            });
            const canceled=GM.download({url:'/hang',name:'aborted.txt'});canceled.abort();
            let downloadAborted=false;try{await canceled;}catch(error){downloadAborted=error.details?.status==='canceled';}
            if(!downloadAborted)throw Error('download abort');
            for(const name of ['../escape.txt','/tmp/escape.txt']){
                let rejected=false;try{await GM.download({url:'/one',name});}catch{rejected=true;}
                if(!rejected)throw Error('download path policy');
            }
            if(typeof GM.__download!=='undefined'||typeof GM.__downloadWatch!=='undefined')throw Error('private download binding');
            for(const path of ['/headers','/download-redirect','/download-cross']){
                const result=await GM.download({url:path,name:path.slice(1)+'.txt',headers:{Authorization:'Bearer fixture','X-Download':'test'}});
                if(result.status!=='completed')throw Error('download request headers');
            }
            for(const headers of [{Host:'evil.invalid'},{Range:'bytes=1-'},{'X-Test':'bad\r\nInjected: yes'}]){
                let rejected=false;try{await GM.download({url:'/one',name:'invalid.txt',headers});}catch{rejected=true;}
                if(!rejected)throw Error('invalid download header accepted');
            }
            const payload=new Uint8Array(300000);for(let i=0;i<payload.length;i++)payload[i]=i%251;
            let blobProgress=0;
            await GM.download({url:new Blob([payload]),name:'blob.bin',onprogress:()=>blobProgress++});
            if(blobProgress<3)throw Error('Blob streaming progress');
            await GM.download(new File(['file contents'],'file.txt'));
            await new Promise((resolve,reject)=>GM_download({url:new Blob([]),name:'empty.bin',onload:resolve,onerror:reject}));
            const objectURL=URL.createObjectURL(new Blob(['object URL']));
            try{await GM.download(objectURL,'object.txt');}finally{URL.revokeObjectURL(objectURL);}
            const partial=GM.download({url:new Blob([payload]),name:'partial.bin',onprogress:()=>partial.abort()});
            let partialAborted=false;try{await partial;}catch{partialAborted=true;}
            if(!partialAborted)throw Error('Blob cancellation');
            if(typeof GM.__downloadChunk!=='undefined'||typeof GM.__downloadFinish!=='undefined')throw Error('private Blob binding');
            await GM.download({url:new Blob(['first']),name:'collision.txt'});
            await GM.download({url:new Blob(['second']),name:'collision.txt'});
            await GM.download({url:new Blob(['replacement']),name:'collision.txt',conflictAction:'overwrite'});
            await GM.download({url:new Blob(['chosen']),name:'chosen.txt',saveAs:true});
            await GM.download({url:new Blob(['prompt']),name:'prompt.txt',conflictAction:'prompt'});
            const waiting=GM.download({url:new Blob(['must not save']),name:'picker-abort.txt',saveAs:true});waiting.abort();
            let pickerCanceled=false;try{await waiting;}catch{pickerCanceled=true;}
            if(!pickerCanceled)throw Error('picker cancellation');
            console.log('STAGE:downloads');
            await new Promise((resolve,reject)=>{
                let clicked=false;
                GM.notification({text:'modern body',title:'Modern click',silent:true,onclick:event=>{if(!(event instanceof Event))reject(Error('notification event'));clicked=true;},ondone:wasClicked=>clicked&&wasClicked?resolve():reject(Error('modern notification callback'))}).catch(reject);
            });
            await new Promise((resolve,reject)=>{
                const result=GM_notification({text:'legacy body',title:'Legacy click',silent:true,ondone:clicked=>clicked?resolve():reject(Error('legacy notification callback'))});
                if(result!==undefined)reject(Error('legacy notification return'));
            });
            let firstDone;const replaced=new Promise(resolve=>firstDone=resolve);
            const firstNotification=GM.notification({text:'first',tag:'replace',ondone:clicked=>{if(clicked)throw Error('replacement click');firstDone();}});
            await new Promise((resolve,reject)=>{GM.notification({text:'second',tag:'replace',timeout:30,ondone:resolve}).catch(reject);});
            await replaced;
            if(await firstNotification!==false)throw Error('replacement result');
            if(typeof GM.__notify!=='undefined'||typeof GM.__notifyWait!=='undefined')throw Error('private notification bindings');
            await new Promise((resolve,reject)=>GM.notification({text:'link',title:'URL click',silent:true,url:'/notification-target',ondone:clicked=>clicked?resolve():reject(Error('URL click'))}).catch(reject));
            await new Promise((resolve,reject)=>GM.notification({text:'prevent',title:'Prevent URL',silent:true,url:'/must-not-open',onclick:event=>event.preventDefault(),ondone:clicked=>clicked?resolve():reject(Error('prevented click'))}).catch(reject));
            for(const url of ['javascript:alert(1)','file:///tmp/a','https://user:pass@example.org/']){
                let rejected=false;try{await GM.notification({text:'invalid',url});}catch{rejected=true;}if(!rejected)throw Error('notification URL policy');
            }
            if(typeof GM.__notifyActivate!=='undefined')throw Error('private notification action binding');
            await new Promise((resolve,reject)=>GM.notification({text:'image',title:'Image decoded',highlight:true,image:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',timeout:30,ondone:resolve}).catch(reject));
            await new Promise((resolve,reject)=>GM.notification({text:'fallback',title:'Image fallback',image:'data:image/png;base64,bm90LWltYWdl',timeout:30,ondone:resolve}).catch(reject));
            if(await GM.notification({highlight:true})!==false)throw Error('highlight result');
            if(await GM.notification({text:'promise',title:'Modern click',silent:true})!==true)throw Error('click promise result');
            if(await GM.notification({text:'timeout promise',timeout:30})!==false)throw Error('timeout promise result');
            await new Promise((resolve,reject)=>{const value=GM_notification({highlight:true,ondone:clicked=>clicked?reject(Error('highlight click')):resolve()});if(value!==undefined)reject(Error('legacy highlight return'));});
            console.log('STAGE:notifications');
            const opened=await GM.openInTab('/modern-tab',{active:false,insert:true,setParent:true});
            if(opened.closed) throw Error('new tab already closed');
            await new Promise(resolve=>{opened.onclose=resolve;opened.close();});
            if(!opened.closed) throw Error('modern tab close state');
            const legacy=GM_openInTab('/legacy-tab',true);
            if(legacy instanceof Promise || legacy.closed) throw Error('legacy tab handle');
            await new Promise(resolve=>{legacy.onclose=resolve;legacy.close();});
            if(!legacy.closed) throw Error('legacy tab close state');
            let invalidTab=false;try{await GM.openInTab('javascript:alert(1)');}catch{invalidTab=true;}
            if(!invalidTab) throw Error('tab URL policy');
            if(typeof GM.__tabOpen!=='undefined'||typeof GM.__tabWatch!=='undefined') throw Error('tab private bindings');
            let menuResolve;const menuDone=new Promise(resolve=>menuResolve=resolve);
            const menuId=await GM.registerMenuCommand('Menu initial',()=>{throw Error('old menu callback');});
            const updated=await GM.registerMenuCommand('Menu modern updated',event=>{
                if(!(event instanceof MouseEvent)||!event.shiftKey)throw Error('menu event');menuResolve();
            },{id:menuId,title:'Tooltip',accessKey:'m',autoClose:false});
            if(updated!==menuId)throw Error('menu update identity');
            await menuDone;await GM.unregisterMenuCommand(menuId);
            let legacyMenuResolve;const legacyMenuDone=new Promise(resolve=>legacyMenuResolve=resolve);
            const legacyMenuId=GM_registerMenuCommand('Menu legacy',event=>{if(!(event instanceof MouseEvent))throw Error('legacy menu event');legacyMenuResolve();},'l');
            if(typeof legacyMenuId!=='number')throw Error('legacy menu id');
            await legacyMenuDone;GM_unregisterMenuCommand(legacyMenuId);
            if(typeof GM.__menuWait!=='undefined')throw Error('private menu binding');
            console.log('STAGE:resources');
            const result = await GM.xmlHttpRequest({url:new URL('/two',document.baseURI).href,anonymous:true});
            if (result.status !== 200 || result.responseText !== 'library.push(2);' || result.response !== result.responseText) throw Error('network text');
            const binary = await GM.xmlHttpRequest({url:new URL('/one',document.baseURI).href,responseType:'arraybuffer',anonymous:true});
            if (!(binary.response instanceof ArrayBuffer) || new TextDecoder().decode(binary.response)!=='var library = [1];') throw Error('network binary');
            await new Promise((resolve,reject)=>GM_xmlhttpRequest({url:new URL('/redirect',document.baseURI).href,anonymous:true,onload:r=>r.status===200?resolve():reject(Error('legacy status')),onerror:reject}));
            console.log('STAGE:network');
            let denied = false;
            try { await GM.xmlHttpRequest({url:'http://different.invalid/',anonymous:true}); } catch { denied=true; }
            if (!denied) throw Error('connect policy');
            let aborted = false;
            const request = GM.xmlHttpRequest({url:new URL('/hang',document.baseURI).href,anonymous:true,onabort:()=>{aborted=true;}});
            request.abort();
            try { await request; } catch {}
            if (!aborted) throw Error('abort callback');
            // All four requests overlap: one 31-second wait crosses both the
            // old provider (25s) and correlation/synchronous RPC (30s) limits.
            {
            const slow = timeout => GM.xmlHttpRequest({url:'/slow-headers',anonymous:true,timeout});
            const noDeadline = slow(0), explicitDeadline = slow(45000);
            const streamed = (async()=>{
                const result=await GM.xmlHttpRequest({url:'/idle-stream',responseType:'stream',anonymous:true});
                const reader=result.response.getReader();let text='';
                for(;;){const chunk=await reader.read();if(chunk.done)break;text+=new TextDecoder().decode(chunk.value);}
                if(text!=='slow')throw Error('idle stream payload');
            })();
            const synchronous=GM_xmlhttpRequest({url:'/slow-headers',synchronous:true,anonymous:true});
            if(synchronous.responseText!=='slow')throw Error('long synchronous request');
            const results=await Promise.all([noDeadline,explicitDeadline,streamed]);
            if(results[0].responseText!=='slow'||results[1].responseText!=='slow')throw Error('long buffered request');
            }
            document.documentElement.setAttribute('data-batch-result','BATCH:OK');
        })().catch(error=>document.documentElement.setAttribute('data-batch-result','BATCH:'+String(error.stack||error)));
    )JS"sv);
    MUST(application->set_derpbird_user_scripts(cached_resources));
    auto theme = MUST(Gfx::load_system_theme(ByteString::formatted("{}/themes/Default.ini", WebView::s_ladybird_resource_root)));
    auto view = WebView::HeadlessWebView::create(move(theme), { 800, 600 });
    {
        // Completion is allowed to destroy the owning panel immediately.
        // No task may touch its QObject/timer after delivering that callback.
        auto* image_owner = new QObject;
        bool image_completed = false;
        auto* image = new Ladybird::DerpBirdNotificationImage(image_owner, view->page(), [&](auto) {
            image_completed = true;
            delete image_owner;
        });
        image->start("invalid-notification-image"_string);
        VERIFY(image_completed);

        auto* request_owner = new QObject;
        bool request_completed = false;
        auto* request = new Ladybird::DerpBirdNetworkRequest(request_owner, {}, *URL::Parser::basic_parse(base), WebView::IsPrivate::No,
            [] { return true; }, [&](auto packet) {
                MUST(move(packet));
                request_completed = true;
                delete request_owner;
            });
        request->cancel();
        VERIFY(request_completed);
        qt.sendPostedEvents(nullptr, QEvent::DeferredDelete);
    }
    HashTable<String> invoked_commands;
    host.commands.on_change = [&] {
        auto commands = host.commands.list(view->page());
        for (auto const& item : commands.values()) {
            auto const& command = item.as_object();
            auto label = command.get_string("label"sv).value();
            if (!label.is_one_of("Menu modern updated"sv, "Menu legacy"sv)) continue;
            auto id = command.get_string("id"sv).value();
            if (invoked_commands.contains(id)) continue;
            invoked_commands.set(id);
            JsonObject event;event.set("keyboard"sv,false);event.set("shiftKey"sv,true);
            MUST(host.commands.invoke(view->page(),id,event));
        }
    };
    Optional<String> runtime_result;
    view->on_console_message = [&](WebView::ConsoleOutput message) {
        if (auto* error = message.output.get_pointer<WebView::ConsoleError>())
            runtime_result = MUST(String::formatted("BATCH:{}: {}", error->name, error->message));
        if (auto* log = message.output.get_pointer<WebView::ConsoleLog>(); log && log->arguments.size() == 1 && log->arguments[0].is_string()) {
            auto text = log->arguments[0].as_string();
            warnln("{}", text);
            if (text.bytes_as_string_view().starts_with("BATCH:"sv)) runtime_result = text;
        }
    };
    bool loaded = false;
    view->on_load_finish = [&](auto const& url) { if (url.scheme() == "http"sv) loaded = true; };
    view->load(*URL::Parser::basic_parse(base));
    while (!loaded) {
        qt.processEvents();
        qt.sendPostedEvents(nullptr, QEvent::DeferredDelete);
        Core::EventLoop::current().pump(Core::EventLoop::WaitMode::PollForEvents);
        usleep(1000);
    }
    view->start_sending_console_output(true, true);
    view->run_javascript(R"JS((()=>{let tries=0;const poll=()=>{
        const result=document.documentElement.getAttribute('data-batch-result');
        if(result)console.log(result);
        else if(++tries>12000)console.log('BATCH:runtime result missing');
        else setTimeout(poll,5);
    };poll()})())JS"_string);
    while (!runtime_result.has_value()) {
        qt.processEvents();
        qt.sendPostedEvents(nullptr, QEvent::DeferredDelete);
        Core::EventLoop::current().pump(Core::EventLoop::WaitMode::PollForEvents);
        usleep(1000);
    }
    outln("{}", *runtime_result);
    VERIFY(*runtime_result == "BATCH:OK"sv);
    VERIFY(invoked_commands.size() == 2 && host.commands.list(view->page()).is_empty());
    host.commands.on_change = {};
    for (auto const& pair : { qMakePair(QString("modern.txt"), QByteArray("library.push(2);")), qMakePair(QString("legacy.txt"), QByteArray("var library = [1];")) }) {
        QFile file(download_directory.filePath(pair.first));
        VERIFY(file.open(QIODevice::ReadOnly));
        VERIFY(file.readAll() == pair.second);
    }
    QFile blob_file(download_directory.filePath("blob.bin"));
    VERIFY(blob_file.open(QIODevice::ReadOnly));
    auto blob_bytes=blob_file.readAll();VERIFY(blob_bytes.size()==300000);
    for(qsizetype i=0;i<blob_bytes.size();++i)VERIFY(static_cast<unsigned char>(blob_bytes[i])==i%251);
    for(auto const& pair : {qMakePair(QString("file.txt"),QByteArray("file contents")),qMakePair(QString("empty.bin"),QByteArray()),qMakePair(QString("object.txt"),QByteArray("object URL"))}){
        QFile file(download_directory.filePath(pair.first));VERIFY(file.open(QIODevice::ReadOnly));VERIFY(file.readAll()==pair.second);
    }
    VERIFY(!QFile::exists(download_directory.filePath("partial.bin")));
    VERIFY(!QFile::exists(download_directory.filePath("aborted.txt")));
    VERIFY(script_tabs.size() == 2 && !script_tabs[0] && !script_tabs[1]);
    VERIFY(QGuiApplication::clipboard()->mimeData()->html() == QString::fromUtf8("<b>clipboard HTML Привет</b>"));
    VERIFY(notification_urls.size()==1 && notification_urls[0]==MUST(String::formatted("{}/notification-target",base)));
    VERIFY(notification_highlights==3);
    VERIFY(decoded_image&&fallback_image);
    VERIFY(pickers==3);
    for(auto const& pair : {qMakePair(QString("collision.txt"),QByteArray("replacement")),qMakePair(QString("collision (1).txt"),QByteArray("second")),qMakePair(QString("chosen.txt"),QByteArray("chosen")),qMakePair(QString("prompt.txt"),QByteArray("prompt"))}){
        QFile file(download_directory.filePath(pair.first));VERIFY(file.open(QIODevice::ReadOnly));VERIFY(file.readAll()==pair.second);
    }
    VERIFY(!QFile::exists(download_directory.filePath("picker-abort.txt")));
    {
        using Protocol = Web::DerpBirdValueProtocol;
        auto dispatch = [&](Protocol::Method method, Optional<ByteBuffer> payload = {}) {
            Protocol::Request request { method, true, "resume-fixture"_string, "1"_string, {} };
            if (payload.has_value()) request.updates.append({ "download"_string, payload.release_value() });
            Optional<ErrorOr<ByteBuffer>> response;
            MUST(host.downloads.dispatch(view->page(), QString("resume-fixture"), request, [] { return true; },
                [&](auto result) { response = move(result); }));
            VERIFY(response.has_value());
            auto bytes = MUST(response.release_value());
            return MUST(Protocol::decode_response(bytes.bytes()));
        };
        auto config = MUST(String::formatted(R"({{"url":"{}","name":"resumed.bin","blobSize":4}})", base));
        dispatch(Protocol::Method::Download, MUST(ByteBuffer::copy(config.bytes())));
        auto& downloader = application->file_downloader();
        auto id = downloader.downloads().last().id;
        dispatch(Protocol::Method::DownloadChunk, MUST(ByteBuffer::copy("ab"sv.bytes())));
        downloader.pause_download(id);
        VERIFY(downloader.download(id)->status == WebView::FileDownloader::DownloadStatus::Paused);
        downloader.resume_download(id);
        dispatch(Protocol::Method::DownloadChunk, MUST(ByteBuffer::copy("cd"sv.bytes())));
        dispatch(Protocol::Method::DownloadFinish);
        auto result = dispatch(Protocol::Method::DownloadWatch);
        auto state = MUST(JsonValue::from_string(StringView { result.value->bytes() }));
        VERIFY(state.as_object().get_string("status"sv) == "completed"sv);
        QFile file(download_directory.filePath("resumed.bin"));
        VERIFY(file.open(QIODevice::ReadOnly) && file.readAll() == QByteArray("abcd"));
    }
    // Revoking the source cancels an unfinished producer-backed transfer.
    {
        using Protocol=Web::DerpBirdValueProtocol;
        bool valid=true,acknowledged=false;
        JsonObject options;options.set("url"sv,base);options.set("name"sv,"revoked.bin"sv);options.set("blobSize"sv,10);
        auto config=JsonValue(move(options)).serialized();
        Protocol::Request request{Protocol::Method::Download,true,"fixture"_string,"1"_string,
            {{"download"_string,MUST(ByteBuffer::copy(config.bytes()))}}};
        MUST(host.downloads.dispatch(view->page(),QString("fixture"),request,[&]{return valid;},[&](auto response){MUST(move(response));acknowledged=true;}));
        VERIFY(acknowledged);
        auto id=application->file_downloader().downloads().last().id;
        valid=false;host.downloads.prune();
        VERIFY(application->file_downloader().download(id)->status==WebView::FileDownloader::DownloadStatus::Canceled);
        VERIFY(!QFile::exists(download_directory.filePath("revoked.bin")));
    }
    runtime_result = {};
    runtime_record.set("source"sv, R"JS((async()=>{
        const tab=await GM.getTab();
        document.documentElement.setAttribute('data-tab-result',tab.count===2&&tab.self===tab?'BATCH:TAB-RESTORED':'BATCH:tab navigation lost data');
    })().catch(error=>document.documentElement.setAttribute('data-tab-result','BATCH:'+error)))JS"sv);
    MUST(application->set_derpbird_user_scripts(cached_resources));
    view->on_load_finish = [&](auto const& url) {
        if (url.scheme() != "http"sv) return;
        view->start_sending_console_output(true, true);
        view->run_javascript(R"JS((()=>{let tries=0;const poll=()=>{
            const result=document.documentElement.getAttribute('data-tab-result');
            if(result)console.log(result);
            else if(++tries>1000)console.log('BATCH:tab navigation result missing');
            else setTimeout(poll,5);
        };poll()})())JS"_string);
    };
    view->load(*URL::Parser::basic_parse(base));
    while (!runtime_result.has_value()) {
        qt.processEvents();
        Core::EventLoop::current().pump(Core::EventLoop::WaitMode::PollForEvents);
        usleep(1000);
    }
    VERIFY(*runtime_result == "BATCH:TAB-RESTORED"sv);
    verify_script_frame_handoff(*application,host,qt,base);
    // Exercise native lifetime and scope boundaries independently of script JS.
    {
        using Protocol = Web::DerpBirdValueProtocol;
        Ladybird::DerpBirdTabData normal_data;
        Ladybird::DerpBirdTabData private_data;
        Protocol::Request save { Protocol::Method::TabSave, true, "token"_string, {}, {} };
        save.updates.append({ "tab-data"_string, MUST(ByteBuffer::copy("opaque-data"sv.bytes())) });
        Protocol::Request get { Protocol::Method::TabGet, true, "token"_string, {}, {} };
        Protocol::Request all { Protocol::Method::TabsGet, true, "token"_string, {}, {} };
        auto read = [&](auto& data, auto& target, String script, auto const& request) {
            auto bytes = MUST(data.dispatch(target, script, request));
            return MUST(Protocol::decode_response(bytes.bytes()));
        };
        read(normal_data, *view, "one"_string, save);
        VERIFY(read(normal_data, *view, "one"_string, get).value.has_value());
        VERIFY(!read(normal_data, *view, "two"_string, get).value.has_value());
        VERIFY(!read(private_data, *view, "one"_string, get).value.has_value());
        {
            auto second_theme = MUST(Gfx::load_system_theme(ByteString::formatted("{}/themes/Default.ini", WebView::s_ladybird_resource_root)));
            auto second = WebView::HeadlessWebView::create(move(second_theme), {800,600});
            VERIFY(!read(normal_data, *second, "one"_string, get).value.has_value());
            read(normal_data, *second, "one"_string, save);
            VERIFY(read(normal_data, *view, "one"_string, all).entries.size()==2);
        }
        VERIFY(read(normal_data, *view, "one"_string, all).entries.size()==1);
    }
    {
        using Cookies = Ladybird::DerpBirdScriptCookies;
        using Protocol = Web::DerpBirdValueProtocol;
        auto normal = WebView::CookieJar::create();
        auto private_jar = WebView::CookieJar::create(WebView::IsPrivate::Yes);
        auto url = URL::Parser::basic_parse("https://example.com/path"sv).release_value();
        auto call = [&](WebView::CookieJar& jar, StringView action, StringView json) -> ErrorOr<JsonValue> {
            Protocol::Request request { Protocol::Method::Cookie, true, "token"_string, MUST(String::from_utf8(action)),
                { { "cookie"_string, TRY(ByteBuffer::copy(json.bytes())) } } };
            auto packet = TRY(Cookies::dispatch(jar, url, request, [&](auto const& target) -> ErrorOr<void> {
                if (target.serialized_host() != url.serialized_host()) return Error::from_string_literal("Denied test host");
                return {};
            }));
            auto response = TRY(Protocol::decode_response(packet.bytes()));
            return JsonValue::from_string(StringView { response.value->bytes() });
        };
        MUST(call(*normal, "set"sv, R"({"name":"private-test","value":"normal","httpOnly":true,"secure":true})"sv));
        VERIFY(MUST(call(*normal, "list"sv, "{}"sv)).as_array().size() == 1);
        VERIFY(MUST(call(*private_jar, "list"sv, "{}"sv)).as_array().is_empty());
        MUST(call(*normal, "set"sv, R"({"name":"private-test","value":"partition","secure":true,"partitionKey":{"topLevelSite":"https://top.example/"}})"sv));
        VERIFY(MUST(call(*normal, "list"sv, "{}"sv)).as_array().size() == 1);
        VERIFY(MUST(call(*normal, "list"sv, R"({"partitionKey":{}})"sv)).as_array().size() == 2);
        MUST(call(*normal, "delete"sv, R"({"name":"private-test","partitionKey":{"topLevelSite":"https://top.example/"}})"sv));
        VERIFY(MUST(call(*normal, "list"sv, R"({"partitionKey":{}})"sv)).as_array().size() == 1);
        VERIFY(call(*normal, "set"sv, R"({"name":"bad","value":"x","domain":"other.example"})"sv).is_error());
        VERIFY(call(*normal, "set"sv, R"({"name":"__Host-bad","value":"x","secure":true,"domain":"example.com","path":"/"})"sv).is_error());
        VERIFY(call(*normal, "list"sv, R"({"url":"https://other.example/"})"sv).is_error());
        VERIFY(call(*normal, "set"sv, R"({"name":"bad","value":"x","expirationDate":"forever"})"sv).is_error());
    }
    {
        // A tagged notification survives document revocation, but never the
        // original browsing session or installed-script authority.
        Ladybird::DerpBirdScriptNotifications persistent(nullptr);
        WebView::RecordingNotificationBackend* backend = nullptr;
        persistent.create_backend = [&]() -> NonnullOwnPtr<WebView::NotificationBackend> {
            auto result = make<WebView::RecordingNotificationBackend>(); backend = result.ptr(); return result;
        };
        bool document_active = true, installed = true;
        auto notify = [&](StringView token, StringView tag, StringView url = {}) {
            using Protocol = Web::DerpBirdValueProtocol;
            auto json = MUST(String::formatted(R"({{"text":"persistence","title":"Persistence","tag":"{}","url":"{}","timeout":0}})", tag, url));
            Protocol::Request request { Protocol::Method::Notify, true, "identity"_string, "1"_string,
                { { "notification"_string, MUST(ByteBuffer::copy(json.bytes())) } } };
            bool completed = false;
            MUST(persistent.dispatch(view->page(), QString::fromUtf8(token.characters_without_null_termination(), token.length()),
                "session:" , "Fixture"_string, request, [&] { return document_active; },
                [&](auto response) { MUST(move(response)); completed = true; }, [&] { return installed; }));
            VERIFY(completed);
        };
        notify("first"sv, "retained"sv);
        VERIFY(backend && backend->shown().size() == 1);
        document_active = false;
        persistent.prune();
        VERIFY(backend->shown().size() == 1);
        document_active = true;
        notify("second"sv, "retained"sv);
        VERIFY(backend->shown().size() == 1);
        document_active = false;
        installed = false;
        persistent.prune();
        VERIFY(backend->shown().is_empty());
        document_active = true; installed = true;
        notify("url-only"sv, ""sv, "https://example.com/retained"sv);
        document_active = false;
        persistent.prune();
        VERIFY(backend->shown().size() == 1);
        installed = false;
        persistent.prune();
        VERIFY(backend->shown().is_empty());
        document_active = true; installed = true;
        notify("third"sv, "retained"sv);
        persistent.close_session("session:");
        VERIFY(backend->shown().is_empty());
    }
    bool closed = false;
    host.shutdown([&] { closed = true; });
    while (!closed) {
        qt.processEvents();
        qt.sendPostedEvents(nullptr, QEvent::DeferredDelete);
        Core::EventLoop::current().pump(Core::EventLoop::WaitMode::PollForEvents);
        usleep(1000);
    }
    puts("Dependency HTTP install, redirect, cache, integrity and rollback checks passed");
}
