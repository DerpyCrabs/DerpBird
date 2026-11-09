#include <LibURL/Parser.h>
#include <NavigationPolicy.h>
#include <cstdio>
#include <cstdlib>

static void check(StringView input, bool allowed)
{
    auto url = URL::Parser::basic_parse(input);
    if (!url.has_value() || Ladybird::is_public_navigation_url(*url) != allowed) {
        std::fprintf(stderr, "Unexpected navigation policy for %.*s\n", static_cast<int>(input.length()), input.characters_without_null_termination());
        std::exit(EXIT_FAILURE);
    }
}

int main()
{
    for (auto input : { "https://example.org/"sv, "http://localhost:8000/"sv,
             "file:///tmp/example.html"sv, "about:blank"sv, "about:history"sv,
             "about:downloads"sv, "about:bookmarks"sv, "about:settings#privacy"sv,
             "about:version"sv, "about:newtab"sv })
        check(input, true);
    for (auto input : { "about:derpbird"sv, "about:derpbird#fragment"sv,
             "about:config"sv, "about:%64erpbird"sv, "about:Settings"sv,
             "resource://ladybird/about-pages/derpbird.html"sv,
             "javascript:alert(1)"sv, "data:text/html,hello"sv })
        check(input, false);
    std::puts("Native navigation policy checks passed");
}
