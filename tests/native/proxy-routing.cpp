#include <AK/JsonArray.h>
#include <AK/JsonObject.h>
#include <LibHTTP/Proxy.h>
#include <LibURL/Parser.h>
#include <QFile>
#include <cstdio>

static JsonObject options()
{
    return MUST(JsonValue::from_string(R"({"schemaVersion":2,"-startupProfileName":"auto","+proxy":{"name":"proxy","profileType":"FixedProfile","fallbackProxy":{"scheme":"socks5","host":"127.0.0.1","port":1080},"proxyForHttps":{"scheme":"http","host":"secure.test","port":3128},"bypassList":[{"conditionType":"BypassCondition","pattern":"<local>"},{"conditionType":"BypassCondition","pattern":"10.0.0.0/8"}]},"+auto":{"name":"auto","profileType":"SwitchProfile","defaultProfileName":"direct","rules":[{"condition":{"conditionType":"HostWildcardCondition","pattern":"private.example.test"},"profileName":"direct"},{"condition":{"conditionType":"HostWildcardCondition","pattern":"*.example.test|.example.org"},"profileName":"proxy"}]}})"sv)).as_object();
}
int main(int argc, char** argv)
{
    HTTP::ProxyConfiguration config;
    auto data = options();
    MUST(config.set_omega(data, "auto"_string));
    auto route = [&](StringView address) { return config.proxy_for(URL::Parser::basic_parse(address).release_value()).copy(); };
    VERIFY(route("http://example.test/"sv)->type == HTTP::Proxy::Type::SOCKS5Hostname);
    VERIFY(route("http://child.example.test/"sv)->resolves_hostnames());
    VERIFY(route("http://example.org/"sv).has_value());
    VERIFY(!route("http://notexample.test/"sv).has_value());
    VERIFY(!route("http://private.example.test/"sv).has_value());
    VERIFY(!route("http://elsewhere.test/"sv).has_value());
    VERIFY(route("https://example.test/"sv)->host == "secure.test"sv);
    VERIFY(route("wss://example.test/"sv)->host == "secure.test"sv);
    VERIFY(route("ws://example.test/"sv)->type == HTTP::Proxy::Type::SOCKS5Hostname);
    MUST(config.set_omega(data, "proxy"_string));
    VERIFY(!route("http://localhost/"sv).has_value());
    VERIFY(!route("http://127.0.0.1/"sv).has_value());
    VERIFY(!route("http://[::1]/"sv).has_value());
    VERIFY(!route("http://10.2.3.4/"sv).has_value());
    VERIFY(route("http://11.2.3.4/"sv).has_value());
    MUST(config.set_omega(data, "direct"_string));
    VERIFY(!route("https://example.test/"sv).has_value());
    auto invalid = data;
    invalid.get_object("+auto"sv)->set("defaultProfileName"sv, "auto"sv);
    VERIFY(config.set_omega(invalid, "auto"_string).is_error());
    VERIFY(config.active_profile() == "direct"sv);
    invalid = data; invalid.get_object("+auto"sv)->set("defaultProfileName"sv, "missing"sv);
    VERIFY(config.set_omega(invalid, "auto"_string).is_error());
    invalid = data; invalid.get_object("+proxy"sv)->set("profileType"sv, "PacProfile"sv);
    VERIFY(config.set_omega(invalid, "auto"_string).is_error());
    invalid = data; invalid.get_object("+proxy"sv)->get_object("fallbackProxy"sv)->set("port"sv, 70000);
    VERIFY(config.set_omega(invalid, "auto"_string).is_error());
    auto rule = data.get_object("+auto"sv)->get_array("rules"sv)->values()[1].as_object().get_object("condition"sv);
    rule->set("pattern"sv, "**.example.test"sv);
    MUST(config.set_omega(data, "auto"_string));
    VERIFY(!route("http://example.test/"sv).has_value());
    VERIFY(route("http://a.example.test/"sv).has_value());
    rule->set("conditionType"sv, "UrlRegexCondition"sv); rule->set("pattern"sv, "^https://.*[.]test/secure"sv);
    MUST(config.set_omega(data, "auto"_string));
    VERIFY(route("https://other.test/secure/path"sv).has_value());
    VERIFY(!route("https://other.test/public"sv).has_value());
    rule->set("conditionType"sv, "KeywordCondition"sv); rule->set("pattern"sv, "keyword"sv);
    MUST(config.set_omega(data, "auto"_string));
    VERIFY(route("http://other.test/keyword"sv).has_value());
    VERIFY(!route("https://other.test/keyword"sv).has_value());
    rule->set("conditionType"sv, "UrlRegexCondition"sv);
    rule->set("pattern"sv, "["sv);
    VERIFY(config.set_omega(data, "auto"_string).is_error());
    // Optional private corpus is read in place and never copied into fixtures or logs.
    if (argc > 1) {
        QFile file(QString::fromUtf8(argv[1])); VERIFY(file.open(QIODevice::ReadOnly));
        auto bytes = file.readAll();
        auto original = MUST(JsonValue::from_string(StringView(bytes.constData(), bytes.size())));
        auto backup = original.as_object();
        MUST(config.set_omega(backup, backup.get_string("-startupProfileName"sv).value()));
        VERIFY(JsonValue(config.omega_options()).serialized() == original.serialized());
        size_t count = 0;
        backup.for_each_member([&](auto const& key, auto const& value) {
            if (!key.starts_with('+') || !value.is_object()) return;
            auto rules = value.as_object().get_array("rules"sv);
            if (!rules.has_value()) return;
            for (auto const& item : rules->values()) {
                auto const& rule = item.as_object();
                auto pattern = rule.get_object("condition"sv)->get_string("pattern"sv).value();
                auto host = pattern.bytes_as_string_view();
                if (host.starts_with("*."sv)) host = host.substring_view(2);
                if (host.contains('*') || host.contains('?') || host.contains('|')) continue;
                auto url = MUST(String::formatted("https://{}/", host));
                auto parsed = URL::Parser::basic_parse(url); VERIFY(parsed.has_value());
                if (rule.get_string("profileName"sv) == "proxy"sv) VERIFY(config.proxy_for(*parsed).has_value());
                ++count;
            }
        });
        printf("Private backup: lossless round trip; %zu concrete rule hosts checked.\n", count);
    }
    puts("Proxy routing and validation passed.");
}
