#include <DerpBirdStyleRule.h>
#include <cstdio>
#include <cstdlib>

static void check(Web::DerpBirdStyleCondition const& condition, StringView input, bool expected)
{
    auto url = URL::Parser::basic_parse(input);
    if (!url.has_value() || condition.matches(*url) != expected) {
        std::fprintf(stderr, "Unexpected style match: %.*s\n", static_cast<int>(input.length()), input.characters_without_null_termination());
        std::exit(EXIT_FAILURE);
    }
}

int main()
{
    auto domain = MUST(Web::DerpBirdStyleCondition::create("domain"sv, "example.com"_string));
    check(domain, "https://example.com/"sv, true);
    check(domain, "http://a.example.com:8080/path"sv, true);
    check(domain, "https://notexample.com/"sv, false);
    check(domain, "https://example.com.evil.test/"sv, false);
    check(domain, "https://example.org/?example.com"sv, false);
    auto exact = MUST(Web::DerpBirdStyleCondition::create("url"sv, "https://example.com/a"_string));
    check(exact, "https://example.com/a#fragment"sv, true);
    check(exact, "https://example.com/ab"sv, false);
    auto fragment = MUST(Web::DerpBirdStyleCondition::create("url"sv, "https://example.com/a#one"_string));
    check(fragment, "https://example.com/a#two"sv, false);
    auto prefix = MUST(Web::DerpBirdStyleCondition::create("url-prefix"sv, "https://example.com/A"_string));
    check(prefix, "https://example.com/Ab"sv, true);
    check(prefix, "https://example.com/ab"sv, false);
    auto regexp = MUST(Web::DerpBirdStyleCondition::create("regexp"sv, "https://example\\.com/(a|b)\\1"_string));
    check(regexp, "https://example.com/aa"sv, true);
    check(regexp, "https://example.com/ab"sv, false);
    check(regexp, "https://example.com/aaa"sv, false);
    auto alternatives = MUST(Web::DerpBirdStyleCondition::create("regexp"sv, "https://a/|https://b/"_string));
    check(alternatives, "https://b/extra"sv, false);
    auto all = MUST(Web::DerpBirdStyleCondition::create("url-prefix"sv, String {}));
    Web::DerpBirdStyleSection global;
    for (auto internal : { "about:derpbird"sv, "about:history"sv, "resource://ladybird/test"sv, "data:text/html,hello"sv, "javascript:1"sv }) {
        check(all, internal, false);
        VERIFY(!global.matches(*URL::Parser::basic_parse(internal)));
    }
    VERIFY(global.matches(*URL::Parser::basic_parse("file:///tmp/page.html"sv)));
    VERIFY(Web::DerpBirdStyleCondition::create("regexp"sv, "["_string).is_error());
    VERIFY(Web::DerpBirdStyleCondition::create("domain"sv, "*.example.com"_string).is_error());
    VERIFY(Web::DerpBirdStyleCondition::create("unknown"sv, String {}).is_error());
    auto scoped_json = MUST(JsonValue::from_string(R"([{"css":"body { color: red }","conditions":[{"type":"domain","value":"example.com"},{"type":"url","value":"https://example.org/"}]}])"sv));
    auto sections = MUST(Web::DerpBirdStyleSection::decode(scoped_json));
    VERIFY(sections.size() == 1);
    VERIFY(sections[0].matches(*URL::Parser::basic_parse("https://example.org/"sv)));
    VERIFY(!sections[0].matches(*URL::Parser::basic_parse("https://example.org/other"sv)));
    for (auto invalid : { R"([{"css":"body{}"}])"sv, R"([{"css":"body{}","conditions":null}])"sv,
             R"([{"css":"body{}","conditions":[{"type":"unknown","value":""}]}])"sv,
             R"([{"css":"body{}","conditions":[{"type":"domain"}]}])"sv })
        VERIFY(Web::DerpBirdStyleSection::decode(MUST(JsonValue::from_string(invalid))).is_error());
    auto nested = MUST(Web::DerpBirdStyleSection::decode(MUST(JsonValue::from_string(R"([{"css":"body{}","conditions":[{"type":"domain","value":"example.com"},{"type":"domain","value":"example.org"}],"conditionGroups":[[{"type":"url-prefix","value":"https://example.com/private/"}]]}])"sv))));
    VERIFY(nested[0].matches(*URL::Parser::basic_parse("https://example.com/private/page"sv)));
    VERIFY(!nested[0].matches(*URL::Parser::basic_parse("https://example.com/public/"sv)));
    VERIFY(!nested[0].matches(*URL::Parser::basic_parse("https://example.org/private/"sv)));
    VERIFY(!nested[0].matches(*URL::Parser::basic_parse("about:derpbird"sv)));
    for (auto invalid : { R"([{"css":"body{}","conditions":[],"conditionGroups":null}])"sv,
             R"([{"css":"body{}","conditions":[],"conditionGroups":[[]]}])"sv,
             R"([{"css":"body{}","conditions":[],"conditionGroups":[{}]}])"sv })
        VERIFY(Web::DerpBirdStyleSection::decode(MUST(JsonValue::from_string(invalid))).is_error());
    // Host budgets must not mutate ordinary regex execution or leak between calls.
    auto raw_pattern = Utf16String::from_utf8("^(a+)+$"sv);
    auto raw = MUST(regex::ECMAScriptRegex::compile(raw_pattern.utf16_view(), {}));
    auto difficult = Utf16String::from_utf8("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaab"sv);
    u64 tiny_budget = 50;
    VERIFY(raw.test_anchored_budgeted(difficult.utf16_view(), 0, tiny_budget) == regex::MatchResult::LimitExceeded);
    VERIFY(tiny_budget == 0);
    auto easy = Utf16String::from_utf8("aaa"sv);
    VERIFY(raw.test(easy.utf16_view(), 0) == regex::MatchResult::Match);
    u64 fresh_budget = 1000;
    VERIFY(raw.test_anchored_budgeted(easy.utf16_view(), 0, fresh_budget) == regex::MatchResult::Match);
    VERIFY(fresh_budget < 1000 && fresh_budget > 0);
    u64 no_budget = 0;
    VERIFY(raw.test_anchored_budgeted(easy.utf16_view(), 0, no_budget) == regex::MatchResult::LimitExceeded);
    VERIFY(no_budget == 0);
    auto unicode_pattern = Utf16String::from_utf8("^(?:😀)+$"sv);
    auto unicode = MUST(regex::ECMAScriptRegex::compile(unicode_pattern.utf16_view(), { .unicode = true }));
    auto unicode_input = Utf16String::from_utf8("😀😀"sv);
    u64 unicode_budget = 1000;
    VERIFY(unicode.test_anchored_budgeted(unicode_input.utf16_view(), 0, unicode_budget) == regex::MatchResult::Match);
    VERIFY(unicode_budget > 0 && unicode_budget < 1000);
    auto mismatch = Utf16String::from_utf8("bbb"sv);
    u64 mismatch_budget = 1000;
    VERIFY(raw.test_anchored_budgeted(mismatch.utf16_view(), 0, mismatch_budget) == regex::MatchResult::NoMatch);
    VERIFY(mismatch_budget > 0 && mismatch_budget < 1000);
    auto expensive = MUST(Web::DerpBirdStyleCondition::create("regexp"sv, "https://example\\.com/(a+)+"_string));
    auto difficult_url = URL::Parser::basic_parse("https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaab"sv).release_value();
    Web::DerpBirdStyleMatchBudget shared;
    for (size_t i = 0; i < 1024; ++i)
        VERIFY(!expensive.matches(difficult_url, shared));
    VERIFY(shared.exceeded);
    VERIFY(shared.remaining < difficult_url.serialize().bytes().size());
    VERIFY(domain.matches(difficult_url, shared));
    auto ordinary_url = URL::Parser::basic_parse("https://example.com/aa"sv).release_value();
    VERIFY(regexp.matches(ordinary_url));
    Web::DerpBirdStyleMatchBudget fair;
    VERIFY(!expensive.matches(difficult_url, fair));
    VERIFY(fair.exceeded && fair.remaining > 70000);
    VERIFY(regexp.matches(ordinary_url, fair));
    auto oversized = MUST(String::formatted("https://example.com/{}", MUST(String::repeated('a', 17000))));
    auto oversized_url = URL::Parser::basic_parse(oversized).release_value();
    Web::DerpBirdStyleMatchBudget oversized_budget;
    VERIFY(!regexp.matches(oversized_url, oversized_budget));
    VERIFY(oversized_budget.remaining == 0 && oversized_budget.exceeded);
    VERIFY(domain.matches(oversized_url, oversized_budget));
    std::puts("Native user-style matching checks passed");
}
