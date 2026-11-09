#include <DerpBirdCredentialVault.h>
#include <cstdio>

int main(int argc, char**)
{
    using Catalog = WebView::DerpBirdCredentialStore;
    using Store = Ladybird::DerpBirdSecretStore;
    auto db = MUST(Database::Database::create_memory_backed());
    auto catalog = MUST(Catalog::create(db));
    auto profile = "vault-test-profile"_string;
    Ladybird::DerpBirdCredentialVault vault(*catalog, profile);
    auto site = URL::Parser::basic_parse("https://example.com/login"sv).release_value();
    auto other = URL::Parser::basic_parse("https://other.test/login"sv).release_value();
    auto* cancel = g_cancellable_new();
    ScopeGuard release = [&] { g_object_unref(cancel); };
    if (argc > 1) {
        VERIFY(vault.save({}, site, "alice"_string, "secret"sv.bytes(), 0, cancel).is_error());
        VERIFY(MUST(catalog->for_origin(site)).is_empty());
        VERIFY(MUST(catalog->garbage()).size() == 1);
        VERIFY(vault.collect_garbage(cancel).is_error());
        VERIFY(MUST(catalog->garbage()).size() == 1);
        return 0;
    }
    auto first = MUST(vault.save({}, site, "alice"_string, "one\0binary"sv.bytes(), 0, cancel));
    VERIFY(MUST(vault.load(first.id, site, cancel))->bytes() == "one\0binary"sv.bytes());
    VERIFY(!MUST(vault.load(first.id, other, cancel)).has_value());
    VERIFY(vault.save(first.id, other, "alice"_string, "wrong"sv.bytes(), first.revision, cancel).is_error());
    VERIFY(vault.save(first.id, site, "alice"_string, "stale"sv.bytes(), first.revision+1, cancel).is_error());
    auto updated = MUST(vault.save(first.id, site, "alice"_string, "two"sv.bytes(), first.revision, cancel));
    VERIFY(updated.id == first.id && updated.secret_id != first.secret_id);
    VERIFY(MUST(vault.load(updated.id, site, cancel))->bytes() == "two"sv.bytes());
    VERIFY(MUST(Store::get(profile, first.secret_id, cancel)).has_value());
    VERIFY(MUST(vault.collect_garbage(cancel)) == 1);
    VERIFY(!MUST(Store::get(profile, first.secret_id, cancel)).has_value());
    VERIFY(vault.save({}, site, "alice"_string, "duplicate"sv.bytes(), 0, cancel).is_error());
    VERIFY(MUST(catalog->for_origin(site)).size() == 1);
    auto garbage = MUST(catalog->garbage());
    VERIFY(garbage.size() == 1 && MUST(Store::get(profile, garbage[0], cancel)).has_value());
    VERIFY(MUST(vault.collect_garbage(cancel)) == 1);
    VERIFY(!MUST(Store::get(profile, garbage[0], cancel)).has_value());
    MUST(vault.remove(updated.id, site, updated.revision, cancel));
    VERIFY(!MUST(vault.load(updated.id, site, cancel)).has_value());
    VERIFY(MUST(Store::get(profile, updated.secret_id, cancel)).has_value());
    VERIFY(MUST(vault.collect_garbage(cancel)) == 1);
    MUST(catalog->prepare_secret("interrupted"_string));
    MUST(Store::put(profile, "interrupted"_string, "unpublished"sv.bytes(), cancel));
    MUST(catalog->recover_pending());
    VERIFY(MUST(vault.collect_garbage(cancel)) == 1);
    VERIFY(!MUST(Store::get(profile, "interrupted"_string, cancel)).has_value());
    g_cancellable_cancel(cancel);
    VERIFY(vault.save({}, site, "cancelled"_string, "secret"sv.bytes(), 0, cancel).is_error());
    VERIFY(MUST(catalog->for_origin(site)).is_empty() && MUST(catalog->garbage()).is_empty());
    std::puts("Credential vault publication, origin binding, replacement and orphan recovery passed");
}
