#include <DerpBirdStyleRule.h>
#include <chrono>
#include <cstdio>

static void measure(char const* label, StringView type, String pattern, StringView address, size_t iterations, bool share_budget = false)
{
    using Clock = std::chrono::steady_clock;
    auto begin_compile = Clock::now();
    auto condition = MUST(Web::DerpBirdStyleCondition::create(type, move(pattern)));
    auto compile_us = std::chrono::duration<double, std::micro>(Clock::now() - begin_compile).count();
    auto url = URL::Parser::basic_parse(address).release_value();
    size_t matches = 0;
    Web::DerpBirdStyleMatchBudget budget;
    auto begin = Clock::now();
    for (size_t i = 0; i < iterations; ++i)
        matches += share_budget ? condition.matches(url, budget) : condition.matches(url);
    auto elapsed_us = std::chrono::duration<double, std::micro>(Clock::now() - begin).count();
    std::printf("{\"case\":\"%s\",\"iterations\":%zu,\"compile_us\":%.3f,\"total_match_us\":%.3f,\"mean_match_us\":%.3f,\"matches\":%zu}\n", label, iterations, compile_us, elapsed_us, elapsed_us / iterations, matches);
}

int main()
{
    measure("domain", "domain"sv, "example.com"_string, "https://sub.example.com/page"sv, 10000);
    measure("prefix", "url-prefix"sv, "https://example.com/"_string, "https://example.com/page"sv, 10000);
    measure("regexp", "regexp"sv, "https://example\\.com/.*"_string, "https://example.com/page"sv, 10000);
    measure("backtracking", "regexp"sv, "https://example\\.com/(a+)+"_string, "https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaab"sv, 1);
    measure("registry-1024-backtracking", "regexp"sv, "https://example\\.com/(a+)+"_string, "https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaab"sv, 1024, true);
    auto long_address = MUST(String::formatted("https://example.com/{}b", MUST(String::repeated('a', 8000))));
    measure("long-greedy", "regexp"sv, "https://example\\.com/(?:a+){20}"_string, long_address.bytes_as_string_view(), 1);
    measure("long-alternation", "regexp"sv, "https://example\\.com/(a|aa)+"_string, long_address.bytes_as_string_view(), 1);

}
