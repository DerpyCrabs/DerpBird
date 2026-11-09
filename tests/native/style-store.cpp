#include <DerpBirdStyleStore.h>
#include <QTemporaryDir>
#include <cstdio>

int main()
{
    QTemporaryDir temporary;
    VERIFY(temporary.isValid());
    auto path = temporary.path() + "/profile/styles.json";
    Ladybird::DerpBirdStyleStore store(path);
    MUST(store.load());
    VERIFY(store.items().is_empty());
    VERIFY(store.revision() == 0);
    auto data = MUST(JsonValue::from_string(R"([{"id":"one","name":"Example","enabled":true,"source":"body{}","usercss":{"values":{"accent":"#abcdef","size":16}},"sections":[{"conditions":[{"type":"domain","value":"example.com"}],"css":"body{}"}]}])"sv));
    data.as_array().values()[0].as_object().set("imports"sv, MUST(JsonValue::from_string(R"({"https://styles.example/library.less":{"url":"https://cdn.example/library.less","source":"@accent: #abcdef;"}})"sv)));
    auto& persisted_section = data.as_array().values()[0].as_object().get_array("sections"sv)->values()[0].as_object();
    persisted_section.set("conditionGroups"sv, MUST(JsonValue::from_string(R"([[{"type":"url-prefix","value":"https://example.com/private/"}]])"sv)));
    MUST(store.replace(data.as_array()));
    VERIFY(store.revision() == 1);
    VERIFY(store.enabled_sections().size() == 1);
    VERIFY(store.enabled_sections().at(0).as_object().get_string("sourceId"sv) == "one"sv);
    VERIFY(!store.items().at(0).as_object().get_array("sections"sv)->at(0).as_object().has("sourceId"sv));
    auto owned = make<Ladybird::DerpBirdStyleStore>(path);
    auto& reopened = *owned;
    MUST(reopened.load());
    VERIFY(JsonValue(reopened.items()).serialized() == data.serialized());
    QFile file(path);
    VERIFY(file.open(QIODevice::ReadOnly));
    auto original = file.readAll();
    file.close();
    auto duplicate = data.as_array();
    duplicate.must_append(data.as_array().at(0));
    VERIFY(store.replace(move(duplicate)).is_error());
    VERIFY(store.revision() == 1);
    VERIFY(file.open(QIODevice::ReadOnly));
    VERIFY(file.readAll() == original);
    file.close();
    VERIFY(store.items().size() == 1);
    auto invalid_config = data.as_array();
    invalid_config.values()[0].as_object().set("usercss"sv, MUST(JsonValue::from_string(R"({"values":{"accent":false}})"sv)));
    VERIFY(store.replace(move(invalid_config)).is_error());
    VERIFY(store.revision() == 1);

    auto invalid_import = data.as_array();
    invalid_import.values()[0].as_object().set("imports"sv, MUST(JsonValue::from_string(R"({"file:///etc/passwd":{"url":"file:///etc/passwd","source":"not a remote dependency"}})"sv)));
    VERIFY(store.replace(move(invalid_import)).is_error());
    VERIFY(store.revision() == 1);

    JsonArray disabled;
    auto disabled_item = data.as_array().at(0).as_object();
    disabled_item.set("enabled"sv, false);
    disabled.must_append(move(disabled_item));
    MUST(store.replace(move(disabled)));
    VERIFY(store.revision() == 2);
    VERIFY(store.enabled_sections().is_empty());
    // Failed loading leaves the last known good in-memory state intact.
    VERIFY(file.open(QIODevice::WriteOnly | QIODevice::Truncate));
    VERIFY(file.write("{broken") == 7);
    file.close();
    VERIFY(store.load().is_error());
    VERIFY(store.items().size() == 1);
    VERIFY(store.enabled_sections().is_empty());
    // An unwritable destination must not publish an in-memory update.
    Ladybird::DerpBirdStyleStore impossible(temporary.path());
    VERIFY(impossible.replace(data.as_array()).is_error());
    VERIFY(impossible.items().is_empty());
    MUST(store.replace(JsonArray {}));
    MUST(reopened.load());
    VERIFY(reopened.items().is_empty());
    std::puts("User style persistence checks passed");
}
