#include <DerpBirdCredentialStore.h>
#include <QTemporaryDir>
#include <cstdio>

using Store = WebView::DerpBirdCredentialStore;
static URL::URL url(StringView text) { return URL::Parser::basic_parse(text).release_value(); }
int main()
{
    QTemporaryDir directory;
    VERIFY(directory.isValid());
    auto path = directory.path().toUtf8();
    auto db = MUST(Database::Database::create(ByteString(path.constData()), "Credentials"sv));
    auto store = MUST(Store::create(db));
    auto site = url("https://example.com/login?next=1#x"sv);
    VERIFY(MUST(Store::origin_for(url("https://EXAMPLE.com:443/path"sv))) == "https://example.com"sv);
    VERIFY(Store::origin_for(url("file:///tmp/login.html"sv)).is_error());
    VERIFY(Store::origin_for(url("https://user:pass@example.com/"sv)).is_error());
    VERIFY(MUST(store->save_exceptions()).is_empty());
    MUST(store->set_save_exception(site, true));
    MUST(store->set_save_exception(site, true));
    VERIFY(MUST(store->save_exceptions()).size() == 1);
    VERIFY(MUST(store->save_suggestions_blocked(site)));
    for (auto other : { "http://example.com"sv, "https://example.com:444"sv, "https://sub.example.com"sv })
        VERIFY(!MUST(store->save_suggestions_blocked(url(other))));
    VERIFY(store->set_save_exception(url("file:///tmp/test"sv), true).is_error());
    Store::Entry entry { "record"_string, "https://example.com"_string, "alice"_string, "secret-one"_string };
    VERIFY(store->put(entry, 0).is_error());
    MUST(store->prepare_secret(entry.secret_id));
    VERIFY(store->prepare_secret(entry.secret_id).is_error());
    auto first = MUST(store->put(entry, 0));
    VERIFY(first == 1);
    VERIFY(MUST(store->get(entry.id, site))->username == "alice"sv);
    for (auto other : { "http://example.com"sv, "https://example.com:444"sv, "https://sub.example.com"sv, "https://example.com.attacker.test"sv }) {
        VERIFY(!MUST(store->get(entry.id, url(other))).has_value());
        VERIFY(MUST(store->for_origin(url(other))).is_empty());
        VERIFY(store->remove(entry.id, url(other), first).is_error());
    }
    VERIFY(MUST(store->for_origin(site)).size() == 1);
    VERIFY(store->abandon_secret(entry.secret_id).is_error());
    MUST(store->forget_garbage(entry.secret_id)); // Cannot remove a live reference.
    entry.username = "renamed"_string;
    auto renamed = MUST(store->put(entry, first));
    VERIFY(renamed == 2 && MUST(store->garbage()).is_empty());
    entry.secret_id = "secret-two"_string;
    MUST(store->prepare_secret(entry.secret_id));
    VERIFY(store->put(entry, first).is_error());
    auto changed = MUST(store->put(entry, renamed));
    VERIFY(changed == 3 && MUST(store->garbage()).contains_slow("secret-one"sv));
    auto collision = entry; collision.id = "other"_string; collision.secret_id = "collision"_string;
    MUST(store->prepare_secret(collision.secret_id));
    VERIFY(store->put(collision, 0).is_error()); // Unique origin/username, rolls back revision/state.
    MUST(store->abandon_secret(collision.secret_id));
    auto moved = entry; moved.origin = "https://other.test"_string;
    VERIFY(store->put(moved, changed).is_error());
    auto malformed = entry; malformed.origin = "https://example.com/path"_string;
    VERIFY(store->put(malformed, changed).is_error());
    malformed = entry; malformed.username = MUST(String::repeated('x',1025));
    VERIFY(store->put(malformed, changed).is_error());
    MUST(store->prepare_secret("interrupted"_string));
    MUST(db->execute_raw("CREATE TRIGGER reject_credential BEFORE UPDATE ON Credentials BEGIN SELECT RAISE(ABORT,'injected'); END;"));
    auto failed = entry; failed.secret_id = "interrupted"_string;
    VERIFY(store->put(failed, changed).is_error());
    VERIFY(MUST(store->get(entry.id, site))->secret_id == "secret-two"sv);
    MUST(db->execute_raw("DROP TRIGGER reject_credential;"));
    store = MUST(Store::create(db));
    MUST(store->recover_pending());
    auto garbage = MUST(store->garbage());
    VERIFY(garbage.size() == 3 && garbage.contains_slow("interrupted"sv));
    VERIFY(store->put(failed, changed).is_error()); // Recovered pending secret cannot be published later.
    MUST(store->remove(entry.id, site, changed));
    VERIFY(!MUST(store->get(entry.id, site)).has_value());
    entry.secret_id = "secret-three"_string;
    MUST(store->prepare_secret(entry.secret_id));
    auto restored = MUST(store->put(entry, 0));
    VERIFY(restored == 5); // Failed transactions did not consume a revision.
    VERIFY(store->put(entry, changed).is_error()); // Same ID cannot revive an old revision.
    for (auto const& id : MUST(store->garbage())) MUST(store->forget_garbage(id));
    VERIFY(MUST(store->garbage()).is_empty());
    store = MUST(Store::create(MUST(Database::Database::create(ByteString(path.constData()), "Credentials"sv))));
    VERIFY(MUST(store->get(entry.id, site))->revision == restored);
    VERIFY(MUST(store->save_suggestions_blocked(site)));
    MUST(store->set_save_exception(site, false));
    MUST(store->set_save_exception(site, false));
    VERIFY(MUST(store->save_exceptions()).is_empty());
    VERIFY(MUST(store->get(entry.id, site))->revision == restored);
    {
        auto bounded = MUST(Store::create(MUST(Database::Database::create_memory_backed())));
        for (size_t i = 0; i < Store::max_entries; ++i)
            MUST(bounded->set_save_exception(url(MUST(String::formatted("https://site{}.example", i))), true));
        VERIFY(bounded->set_save_exception(url("https://overflow.example"sv), true).is_error());
        MUST(bounded->set_save_exception(url("https://site0.example"sv), true));
        MUST(bounded->set_save_exception(url("https://site0.example"sv), false));
        MUST(bounded->set_save_exception(url("https://overflow.example"sv), true));
        VERIFY(MUST(bounded->save_exceptions()).size() == Store::max_entries);
    }
    {
        auto bounded = MUST(Store::create(MUST(Database::Database::create_memory_backed())));
        for (size_t i=0; i<Store::max_secrets; ++i) MUST(bounded->prepare_secret(MUST(String::formatted("s{}",i))));
        VERIFY(bounded->prepare_secret("overflow"_string).is_error());
        MUST(bounded->recover_pending());
        VERIFY(MUST(bounded->garbage()).size() == 128);
        MUST(bounded->forget_garbage("s0"_string));
        MUST(bounded->prepare_secret("replacement"_string));
    }
    {
        auto bounded = MUST(Store::create(MUST(Database::Database::create_memory_backed())));
        i64 revision = 0;
        for (size_t i=0; i<Store::max_entries; ++i) {
            auto id = MUST(String::formatted("e{}",i));
            MUST(bounded->prepare_secret(id));
            revision = MUST(bounded->put({id,"https://example.com"_string,id,id},0));
        }
        MUST(bounded->prepare_secret("overflow"_string));
        VERIFY(bounded->put({"overflow"_string,"https://example.com"_string,"overflow"_string,"overflow"_string},0).is_error());
        auto last = MUST(String::formatted("e{}",Store::max_entries-1));
        VERIFY(MUST(bounded->put({last,"https://example.com"_string,"updated"_string,last},revision)) == revision+1);
        VERIFY(MUST(bounded->for_origin(site)).size() == Store::max_entries);
    }
    std::puts("Credential catalog origin isolation, CAS, recovery, rollback, persistence and bounds passed");
}
