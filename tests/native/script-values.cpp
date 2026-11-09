#include <DerpBirdValueStore.h>
#include <QTemporaryDir>
#include <cstdio>

using Store = WebView::DerpBirdValueStore;
static Store::Update value(String key, StringView payload)
{
    return { move(key), MUST(ByteBuffer::copy(payload.bytes())) };
}
int main()
{
    QTemporaryDir directory;
    VERIFY(directory.isValid());
    auto path = directory.path().toUtf8();
    auto open = [&] { return MUST(Database::Database::create(ByteString(path.constData()), "GMValues"sv)); };
    auto db = open();
    auto store = MUST(Store::create(db));
    auto first = "one"_string, second = "two"_string;
    VERIFY(MUST(store->snapshot(first)).revision == 0);
    Array initial { value("counter"_string, "number:42"sv), value("undefined"_string, "undefined"sv), value(""_string, ""sv) };
    VERIFY(MUST(store->apply(first, initial, 0)) == 1);
    VERIFY(MUST(store->snapshot(second)).values.is_empty());
    auto snapshot = MUST(store->snapshot(first));
    VERIFY(snapshot.values.size() == 3 && snapshot.values[0].key.is_empty() && snapshot.values[0].value.is_empty());
    Array other { value("counter"_string, "number:7"sv) };
    MUST(store->apply(second, other));
    VERIFY(StringView(MUST(store->get(first, "counter"_string))->bytes()) == "number:42"sv);
    VERIFY(!MUST(store->get(first, "missing"_string)).has_value());
    VERIFY(MUST(store->get(first, ""_string)).has_value());
    VERIFY(MUST(store->keys(first)).size() == 3);
    auto reopened = MUST(Store::create(open()));
    auto durable = MUST(reopened->snapshot(first));
    VERIFY(durable.revision == 1 && durable.values.size() == 3);
    VERIFY(StringView(durable.values[1].value.bytes()) == "number:42"sv);
    Array patch { value("counter"_string, "number:43"sv), value("x'); DROP TABLE GMValues;--"_string, "safe"sv) };
    VERIFY(MUST(reopened->apply(first, patch, 1)) == 2);
    VERIFY(store->apply(first, initial, 1).is_error());
    VERIFY(MUST(store->snapshot(first)).revision == 2);
    // Independent-key writes do not replace the whole stale snapshot.
    Array independent { value("other"_string, "boolean:false"sv) };
    MUST(store->apply(first, independent));
    VERIFY(MUST(reopened->snapshot(first)).values.size() == 5);
    Array duplicates { value("a"_string, "1"sv), value("a"_string, "2"sv) };
    VERIFY(store->apply(first, duplicates).is_error());
    VERIFY(store->apply("../one"_string, independent).is_error());
    Array deletion { Store::Update { "undefined"_string, {} } };
    MUST(store->apply(first, deletion));
    VERIFY(MUST(store->snapshot(first)).values.size() == 4);
    VERIFY(MUST(store->snapshot(second)).values.size() == 1);
    // A lock conflict is recoverable and cannot advance the value revision.
    MUST(db->execute_raw("BEGIN IMMEDIATE"));
    auto before = MUST(reopened->snapshot(second));
    VERIFY(reopened->apply(second, other).is_error());
    MUST(db->execute_raw("ROLLBACK"));
    VERIFY(MUST(reopened->snapshot(second)).revision == before.revision);
    // The quota error occurs after SQL writes; the transaction must roll back all of them.
    Vector<Store::Update> large;
    for (int i = 0; i < 9; ++i)
        large.append({ MUST(String::formatted("key{}", i)), MUST(ByteBuffer::create_zeroed(Store::max_value_bytes)) });
    MUST(store->apply("quota"_string, large));
    Array overflow {
        Store::Update { "overflow1"_string, MUST(ByteBuffer::create_zeroed(Store::max_value_bytes)) },
        Store::Update { "overflow2"_string, MUST(ByteBuffer::create_zeroed(Store::max_value_bytes)) }
    };
    VERIFY(store->apply("quota"_string, overflow).is_error());
    auto retained = MUST(store->snapshot("quota"_string));
    VERIFY(retained.revision == 1 && retained.values.size() == 9);
    // A committed event is a detached old/new snapshot, including empty blobs.
    auto event_scope = "events"_string;
    Array event_initial { value("a"_string, "first"sv), value("empty"_string, ""sv) };
    auto created = MUST(store->apply_with_changes(event_scope, event_initial));
    VERIFY(created.revision == 1 && created.changes.size() == 2);
    VERIFY(!created.changes[0].old_value.has_value());
    VERIFY(StringView(created.changes[0].new_value->bytes()) == "first"sv);
    VERIFY(created.changes[1].new_value.has_value() && created.changes[1].new_value->is_empty());
    (*event_initial[0].value)[0] = 'X';
    VERIFY(StringView(created.changes[0].new_value->bytes()) == "first"sv);
    Array event_update { value("a"_string, "second"sv), Store::Update { "empty"_string, {} }, Store::Update { "missing"_string, {} } };
    auto changed = MUST(store->apply_with_changes(event_scope, event_update, 1));
    VERIFY(changed.revision == 2 && changed.changes.size() == 2);
    VERIFY(changed.changes[0].key == "a"sv && StringView(changed.changes[0].old_value->bytes()) == "first"sv);
    VERIFY(StringView(changed.changes[0].new_value->bytes()) == "second"sv);
    VERIFY(changed.changes[1].old_value.has_value() && changed.changes[1].old_value->is_empty() && !changed.changes[1].new_value.has_value());
    auto unchanged = MUST(store->apply_with_changes(event_scope, event_update, 2));
    VERIFY(unchanged.revision == 3 && unchanged.changes.is_empty());
    VERIFY(store->apply_with_changes(event_scope, event_initial, 1).is_error());
    VERIFY(store->apply_with_changes("quota"_string, overflow).is_error());
    VERIFY(MUST(store->snapshot("quota"_string)).revision == 1);
    // Fail after values were written and changes collected: neither may escape.
    MUST(db->execute_raw("CREATE TEMP TRIGGER reject_gm_commit BEFORE UPDATE OF revision ON GMScopes WHEN NEW.id='events' BEGIN SELECT RAISE(ABORT,'fixture'); END;"));
    VERIFY(store->apply_with_changes(event_scope, event_initial, 3).is_error());
    MUST(db->execute_raw("DROP TRIGGER reject_gm_commit;"));
    auto after_failed_commit = MUST(store->snapshot(event_scope));
    VERIFY(after_failed_commit.revision == 3 && after_failed_commit.values.size() == 1);
    VERIFY(StringView(after_failed_commit.values[0].value.bytes()) == "second"sv);
    auto final_change = MUST(store->apply_with_changes(event_scope, event_initial, 3));
    VERIFY(final_change.revision == 4 && final_change.changes.size() == 2);
    VERIFY(StringView(final_change.changes[0].old_value->bytes()) == "second"sv);
    auto private_store = MUST(Store::create(MUST(Database::Database::create_memory_backed())));
    MUST(private_store->apply(first, other));
    VERIFY(MUST(private_store->snapshot(first)).values.size() == 1);
    VERIFY(MUST(store->snapshot(first)).values.size() == 4);
    std::puts("Userscript value storage checks passed");
}
