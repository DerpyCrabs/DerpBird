#include <DerpBirdSourceFolders.h>
#include <QTemporaryDir>
#include <cstdio>

int main()
{
    QTemporaryDir temporary;
    VERIFY(temporary.isValid());
    auto root = temporary.path() + "/styles";
    VERIFY(QDir().mkpath(root + "/nested"));
    auto write = [](QString const& path, QByteArray const& text) {
        QFile file(path);
        VERIFY(file.open(QIODevice::WriteOnly | QIODevice::Truncate));
        VERIFY(file.write(text) == text.size());
    };
    auto configuration = temporary.path() + "/folders.json";
    QJsonArray selected;
    selected.append(root);
    write(configuration, QJsonDocument(selected).toJson());
    write(root + "/nested/theme.user.less", "/* ==UserStyle==\n@name Local\n==/UserStyle== */\n@import '../palette.less';\nbody{color:@accent}");
    write(root + "/palette.less", "@accent: red;");
    write(temporary.path() + "/outside.less", "@secret: blue;");
    VERIFY(QFile::link(temporary.path() + "/outside.less", root + "/escape.less"));
    JsonObject request;
    request.set("action"sv, "list"sv);
    auto scan = [&] { return MUST(Ladybird::derpbird_source_folders(nullptr, configuration, false, request)).as_object(); };
    auto first = scan();
    VERIFY(!first.has("error"sv));
    auto files = first.get_array("files"sv).value();
    VERIFY(files.size() == 1); // The library and the symlink are not installed styles.
    VERIFY(first.get_object("imports"sv)->size() == 2);
    auto original = files.at(0).as_object();
    auto base = original.get_string("sourceBaseURL"sv).value();
    VERIFY(base.bytes_as_string_view().starts_with("https://derpbird-source.invalid/"sv));
    VERIFY(base.bytes_as_string_view().ends_with("/nested/theme.user.less"sv));
    auto revision = original.get_string("dependencyRevision"sv).value();
    auto repeated = scan();
    VERIFY(repeated.get_array("files"sv)->at(0).as_object().get_string("dependencyRevision"sv) == revision);
    write(root + "/palette.less", "@accent: green;");
    auto changed = scan();
    VERIFY(changed.get_array("files"sv)->at(0).as_object().get_string("dependencyRevision"sv) != revision);
    VERIFY(QFile::remove(root + "/palette.less"));
    auto removed = scan();
    VERIFY(removed.get_object("imports"sv)->size() == 1);
    VERIFY(removed.get_array("files"sv)->size() == 1);
    auto scripts_a = temporary.path() + "/scripts-a";
    auto scripts_b = temporary.path() + "/scripts-b";
    VERIFY(QDir().mkpath(scripts_a + "/nested"));
    VERIFY(QDir().mkpath(scripts_b));
    write(scripts_a + "/main.user.js", "// ==UserScript==\n// @name A\n// ==/UserScript==\n");
    write(scripts_b + "/main.user.js", "// ==UserScript==\n// @name B\n// ==/UserScript==\n");
    write(scripts_a + "/nested/library.js", "const color = 'red';");
    selected = QJsonArray { scripts_a + "/nested", scripts_a, scripts_b };
    write(configuration, QJsonDocument(selected).toJson());
    auto script_scan = [&] { return MUST(Ladybird::derpbird_source_folders(nullptr, configuration, true, request)).as_object(); };
    auto script_revisions = [](JsonObject const& snapshot) {
        VERIFY(!snapshot.has("error"sv));
        QMap<QString, QString> revisions;
        for (auto const& file : snapshot.get_array("files"sv)->values()) {
            auto const& entry = file.as_object();
            revisions.insert(qstring_from_ak_string(entry.get_string("source"sv).value()),
                qstring_from_ak_string(entry.get_string("dependencyRevision"sv).value()));
        }
        return revisions;
    };
    auto before_scripts = script_revisions(script_scan());
    VERIFY(before_scripts.size() == 2);
    write(scripts_a + "/nested/library.js", "const color = 'green';");
    auto after_scripts = script_revisions(script_scan());
    for (auto it = before_scripts.cbegin(); it != before_scripts.cend(); ++it) {
        if (it.key().contains("@name A")) VERIFY(after_scripts.value(it.key()) != it.value());
        else VERIFY(after_scripts.value(it.key()) == it.value());
    }
    auto missing = temporary.path() + "/removed/parent/scripts";
    selected = QJsonArray { missing, scripts_b };
    write(configuration, QJsonDocument(selected).toJson());
    QStringList watches;
    auto unavailable = MUST(Ladybird::derpbird_source_folders(nullptr, configuration, true, request, true, &watches)).as_object();
    VERIFY(unavailable.has("error"sv));
    VERIFY(watches.contains(temporary.path()));
    VERIFY(watches.contains(scripts_b));
    VERIFY(!watches.contains(missing));
    VERIFY(QDir().mkpath(missing));
    watches.clear();
    auto recovered = MUST(Ladybird::derpbird_source_folders(nullptr, configuration, true, request, true, &watches)).as_object();
    VERIFY(!recovered.has("error"sv));
    VERIFY(watches.contains(missing));
    VERIFY(watches.contains(QFileInfo(missing).absolutePath()));
    write(configuration, "invalid configuration");
    watches.clear();
    auto invalid = Ladybird::derpbird_source_folders(nullptr, configuration, true, request, true, &watches);
    VERIFY(invalid.is_error());
    VERIFY(watches.contains(configuration));
    VERIFY(watches.contains(temporary.path()));
    std::puts("Directory dependencies, recovery watches, independent/overlapping roots and symlink checks passed");
}
