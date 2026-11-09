#include <DerpBirdScriptStore.h>
#include <QTemporaryDir>
#include <cstdio>

int main()
{
    QTemporaryDir directory;
    VERIFY(directory.isValid());
    auto path = directory.path() + "/profile/userscripts.json";
    Ladybird::DerpBirdScriptStore store(path);
    MUST(store.load());
    VERIFY(store.revision() == 0);
    auto data = MUST(JsonValue::from_string(R"JSON([{
        "id":"one","name":"Example","enabled":true,"fileAccessGranted":false,
        "source":"document.title='userscript';",
        "metadata":{"runAt":"document-end","grantNone":false,"noFrames":true,
        "matches":["https://example.com/*"],"includes":[],"excludeMatches":[],"excludes":[],
        "grants":[],"requires":[],"connects":[],"resources":[]}
    }])JSON"sv));
    MUST(store.replace(data.as_array(), 0));
    VERIFY(store.revision() == 1);
    Ladybird::DerpBirdScriptStore reopened(path);
    MUST(reopened.load());
    VERIFY(JsonValue(reopened.items()).serialized() == data.serialized());
    QFile file(path);
    VERIFY(file.open(QIODevice::ReadOnly));
    auto original = file.readAll();
    file.close();
    VERIFY(!(file.permissions() & (QFileDevice::ReadGroup | QFileDevice::ReadOther | QFileDevice::WriteGroup | QFileDevice::WriteOther)));
    VERIFY(store.replace(JsonArray {}, 0).is_error());
    auto duplicates = data.as_array();
    duplicates.must_append(data.as_array().at(0));
    VERIFY(store.replace(move(duplicates), 1).is_error());
    VERIFY(store.revision() == 1 && store.items().size() == 1);
    VERIFY(file.open(QIODevice::ReadOnly));
    VERIFY(file.readAll() == original);
    file.close();
    VERIFY(file.open(QIODevice::WriteOnly | QIODevice::Truncate));
    VERIFY(file.write("{broken") == 7);
    file.close();
    VERIFY(store.load().is_error());
    VERIFY(store.revision() == 1 && store.items().size() == 1);
    Ladybird::DerpBirdScriptStore impossible(directory.path());
    VERIFY(impossible.replace(data.as_array(), 0).is_error());
    VERIFY(impossible.items().is_empty() && impossible.revision() == 0);
    MUST(store.replace(JsonArray {}, 1));
    MUST(reopened.load());
    VERIFY(reopened.items().is_empty());
    Ladybird::DerpBirdScriptStore permissions(directory.path() + "/permissions.json");
    auto requested = data.as_array();
    requested.values()[0].as_object().set("fileAccessGranted"sv, true);
    MUST(permissions.replace_from_editor(requested, 0));
    VERIFY(!permissions.items().at(0).as_object().get_bool("fileAccessGranted"sv).value());
    VERIFY(permissions.set_file_access("missing"sv, true, 1).is_error());
    VERIFY(permissions.set_file_access("one"sv, true, 0).is_error());
    MUST(permissions.set_file_access("one"sv, true, 1));
    MUST(permissions.set_file_access("one"sv, true, 2)); // No-op does not advance revision.
    VERIFY(permissions.revision() == 2);
    MUST(permissions.replace_from_editor(requested, 2));
    VERIFY(permissions.items().at(0).as_object().get_bool("fileAccessGranted"sv).value());
    requested.values()[0].as_object().set("source"sv, "document.title='changed';"sv);
    MUST(permissions.replace_from_editor(requested, 3));
    VERIFY(!permissions.items().at(0).as_object().get_bool("fileAccessGranted"sv).value());
    MUST(permissions.replace(requested, 4));
    auto metadata = requested.values()[0].as_object().get_object("metadata"sv).value();
    metadata.set("noFrames"sv, false);
    requested.values()[0].as_object().set("metadata"sv, move(metadata));
    MUST(permissions.replace_from_editor(requested, 5));
    VERIFY(!permissions.items().at(0).as_object().get_bool("fileAccessGranted"sv).value());
    VERIFY(permissions.replace_from_editor(data.as_array(), 4).is_error());
    // Only installed native cache survives editor round-trips. Forged bodies
    // are discarded, changed code revokes its cache, failed CAS is atomic.
    auto cached = data.as_array();
    auto& record = cached.values()[0].as_object();
    auto meta = record.get_object("metadata"sv).value();
    JsonArray required_urls;
    required_urls.must_append("https://example.com/library.js"sv);
    meta.set("requires"sv, move(required_urls));
    record.set("metadata"sv, move(meta));
    auto sources = MUST(JsonValue::from_string(R"JSON([{"url":"https://example.com/library.js","source":"var library = 42;"}])JSON"sv));
    record.set("requiredSources"sv, sources);
    Ladybird::DerpBirdScriptStore dependencies(directory.path() + "/dependencies.json");
    auto forged = MUST(dependencies.prepare_from_editor(cached, 0));
    VERIFY(!forged.at(0).as_object().has("requiredSources"sv));
    MUST(dependencies.replace(cached, 0));
    Ladybird::DerpBirdScriptStore restored(directory.path() + "/dependencies.json");
    MUST(restored.load());
    VERIFY(restored.items().at(0).as_object().get("requiredSources"sv)->serialized() == sources.serialized());
    record.set("requiredSources"sv, JsonArray {});
    auto preserved = MUST(dependencies.prepare_from_editor(cached, 1));
    VERIFY(preserved.at(0).as_object().get("requiredSources"sv)->serialized() == sources.serialized());
    VERIFY(dependencies.replace(cached, 1).is_error()); // incomplete cache
    record.set("dependencyRevision"sv, "new-library-revision"sv);
    auto changed_dependency = MUST(dependencies.prepare_from_editor(cached, 1));
    VERIFY(!changed_dependency.at(0).as_object().has("requiredSources"sv));
    record.remove("dependencyRevision"sv);
    record.set("source"sv, "changed()"sv);
    auto revoked = MUST(dependencies.prepare_from_editor(cached, 1));
    VERIFY(!revoked.at(0).as_object().has("requiredSources"sv));
    VERIFY(dependencies.prepare_from_editor(cached, 0).is_error());
    std::puts("Userscript persistence checks passed");
}
