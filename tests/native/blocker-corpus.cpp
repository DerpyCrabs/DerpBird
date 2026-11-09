#include <AK/JsonObject.h>
#include <AK/JsonArray.h>
#include <LibURL/Parser.h>
#include <LibWeb/Loader/ContentBlocker.h>
#include <algorithm>
#include <chrono>
#include <fstream>
#include <iterator>
#include <sys/resource.h>
#include <vector>

using Clock = std::chrono::steady_clock;
static std::string read(char const* path)
{
    std::ifstream file(path, std::ios::binary);
    VERIFY(file.good());
    return { std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>() };
}
int main(int argc, char** argv)
{
    if (argc != 3) { warnln("usage: blocker-corpus bundle.json requests.json"); return 2; }
    auto bundle = read(argv[1]);
    auto cases = read(argv[2]);
    auto input = MUST(JsonValue::from_string(StringView { cases.data(), cases.size() }));
    VERIFY(input.is_array() && !input.as_array().is_empty());
    auto& blocker = Web::ContentBlocker::the();
    auto start = Clock::now();
    MUST(blocker.set_rules_from_bytes({ reinterpret_cast<u8 const*>(bundle.data()), bundle.size() }));
    auto load_ms = std::chrono::duration<double, std::milli>(Clock::now() - start).count();
    struct Request { URL::URL url, source; Web::ContentBlocker::ResourceType type; bool blocked; };
    std::vector<Request> requests;
    JsonArray outcomes;
    size_t failures = 0;
    for (auto const& value : input.as_array().values()) {
        auto const& item = value.as_object();
        auto type = item.get_string("type"sv).value();
        VERIFY(type == "script"sv || type == "xhr"sv);
        requests.push_back({ URL::Parser::basic_parse(item.get_string("url"sv).value()).release_value(),
            URL::Parser::basic_parse(item.get_string("source"sv).value()).release_value(),
            type == "script"sv ? Web::ContentBlocker::ResourceType::Script : Web::ContentBlocker::ResourceType::XMLHttpRequest,
            item.get_bool("blocked"sv).value() });
        auto const& request = requests.back();
        auto decision = blocker.check(request.url, request.source, request.type, "GET"sv);
        auto outcome = item;
        outcome.set("actualBlocked"sv, decision.blocked);
        outcome.set("matchedRule"sv, decision.matched_rule);
        outcomes.must_append(move(outcome));
        failures += decision.blocked != request.blocked;
    }
    std::vector<double> micros;
    for (size_t round = 0; round < 20; ++round) {
        for (auto const& request : requests) {
            auto begin = Clock::now();
            auto decision = blocker.check(request.url, request.source, request.type, "GET"sv);
            micros.push_back(std::chrono::duration<double, std::micro>(Clock::now() - begin).count());
            failures += decision.blocked != request.blocked;
        }
    }
    std::sort(micros.begin(), micros.end());
    rusage usage {};
    getrusage(RUSAGE_SELF, &usage);
    JsonObject report;
    report.set("loadMs"sv, load_ms);
    report.set("samples"sv, micros.size());
    report.set("p50Us"sv, micros[micros.size() / 2]);
    report.set("p95Us"sv, micros[micros.size() * 95 / 100]);
    report.set("maxUs"sv, micros.back());
    report.set("peakRssKiB"sv, static_cast<i64>(usage.ru_maxrss));
    report.set("failures"sv, failures);
    report.set("requests"sv, move(outcomes));
    outln("{}", report.serialized());
    MUST(blocker.set_patterns({}));
    return failures ? 1 : 0;
}
