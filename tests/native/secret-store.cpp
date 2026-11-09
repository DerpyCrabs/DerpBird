#include <DerpBirdSecretStore.h>
#include <cstdio>
#include <cstring>

int main(int argc, char** argv)
{
    using Store = Ladybird::DerpBirdSecretStore;
    auto* cancel = g_cancellable_new();
    ScopeGuard release = [&] { g_object_unref(cancel); };
    auto profile = "test-profile"_string;
    auto id = "test-credential"_string;
    if (argc > 1 && std::strcmp(argv[1], "--restart") == 0) {
        auto bytes = "restart\0credential\xff"sv.bytes();
        MUST(Store::put(profile, id, bytes, cancel));
        VERIFY(MUST(Store::get(profile, id, cancel))->bytes() == bytes);
        std::puts("READY"); std::fflush(stdout);
        VERIFY(std::getchar() == '\n');
        // A failed operation is surfaced once; the user's explicit retry must
        // reconnect without restarting the browser or replaying a write.
        auto first = Store::get(profile, id, cancel);
        if (first.is_error()) std::puts("FIRST_READ_ERROR");
        else VERIFY(first.value().has_value() && first.value()->bytes() == bytes);
        auto recovered = MUST(Store::get(profile, id, cancel));
        VERIFY(recovered.has_value() && recovered->bytes() == bytes);
        MUST(Store::put(profile, id, "after-restart"sv.bytes(), cancel));
        VERIFY(MUST(Store::get(profile, id, cancel))->bytes() == "after-restart"sv.bytes());
        MUST(Store::remove(profile, id, cancel));
        std::puts("RECOVERED");
        return 0;
    }
    if (argc > 1) {
        VERIFY(Store::get(profile, id, cancel).is_error());
        VERIFY(Store::put(profile, id, "unavailable"sv.bytes(), cancel).is_error());
        VERIFY(Store::remove(profile, id, cancel).is_error());
        std::puts("Unavailable Secret Service fails closed");
        return 0;
    }
    MUST(Store::remove(profile, id, cancel));
    VERIFY(!MUST(Store::get(profile, id, cancel)).has_value());
    auto bytes = "binary\0credential\xff"sv.bytes();
    MUST(Store::put(profile, id, bytes, cancel));
    auto loaded = MUST(Store::get(profile, id, cancel));
    VERIFY(loaded.has_value() && loaded->bytes() == bytes);
    VERIFY(!MUST(Store::get("other-profile"_string, id, cancel)).has_value());
    VERIFY(!MUST(Store::get(profile, "other-credential"_string, cancel)).has_value());
    MUST(Store::put(profile, id, "updated"sv.bytes(), cancel));
    VERIFY(StringView(MUST(Store::get(profile, id, cancel))->bytes()) == "updated"sv);
    MUST(Store::put(profile, id, {}, cancel));
    auto empty = MUST(Store::get(profile, id, cancel));
    VERIFY(empty.has_value() && empty->bytes().is_empty());
    auto maximum = MUST(ByteBuffer::create_zeroed(Store::max_secret_bytes));
    MUST(Store::put(profile, id, maximum.bytes(), cancel));
    VERIFY(MUST(Store::get(profile, id, cancel))->bytes() == maximum.bytes());
    auto oversized = MUST(ByteBuffer::create_zeroed(Store::max_secret_bytes + 1));
    VERIFY(Store::put(profile, id, oversized.bytes(), cancel).is_error());
    VERIFY(Store::get("invalid/id"_string, id, cancel).is_error());
    MUST(Store::remove(profile, id, cancel));
    MUST(Store::remove(profile, id, cancel));
    VERIFY(!MUST(Store::get(profile, id, cancel)).has_value());
    g_cancellable_cancel(cancel);
    VERIFY(Store::put(profile, id, bytes, cancel).is_error());
    VERIFY(Store::get(profile, id, cancel).is_error());
    VERIFY(Store::remove(profile, id, cancel).is_error());
    std::puts("System secret service binary storage, isolation, update, removal and cancellation passed");
}
