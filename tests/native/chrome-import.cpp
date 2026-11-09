#include "ChromeImportData.h"
#include <QCoreApplication>
#include <QTemporaryDir>
#include <cassert>
using namespace Ladybird::ChromeImport;
int main(int argc, char** argv)
{
    QCoreApplication app(argc, argv);
    auto csv = passwords("\xef\xbb\xbfname,url,username,password,note\r\nA,https://example.com/login,\"a,b\",\"x\"\"y\nsecond\",\r\nB,android://x,user,secret,\r\n");
    assert(csv.error.isEmpty() && csv.items.size() == 1 && csv.skipped == 1);
    assert(csv.items[0].username == "a,b" && csv.items[0].password == "x\"y\nsecond");
    assert(!passwords("url,username,password\nx,u,\"unterminated").error.isEmpty());
    assert(!passwords("url,url,password\nx,u,p").error.isEmpty());
    assert(!passwords(QByteArray("url,username,password\n") + char(0xff)).error.isEmpty());
    assert(passwords("url,username,password\nhttps://example.com,,secret\n").items.size() == 1);
    assert(passwords("url,username,password\njavascript:alert(1),u,p\nhttps://user:pass@site.test,u,p\n").skipped == 2);
    QSet<QString> known; int added = 0, skipped = 0; QString error;
    QJsonArray input { QJsonObject { { "type", "folder" }, { "name", "Work" }, { "children", QJsonArray {
        QJsonObject { { "type", "url" }, { "name", "A" }, { "url", "https://example.com/" } },
        QJsonObject { { "type", "url" }, { "name", "A" }, { "url", "https://example.com/" } } } } } };
    auto converted = bookmarks(input, known, added, skipped, error);
    assert(error.isEmpty() && added == 1 && skipped == 1 && converted[0].toObject()["children"].toArray().size() == 1);
    assert(bookmarks(input, known, added, skipped, error).isEmpty());
    QTemporaryDir directory;
    auto path = directory.filePath("History");
    sqlite3* db; assert(sqlite3_open(path.toUtf8(), &db) == SQLITE_OK);
    assert(sqlite3_exec(db, "CREATE TABLE urls(url TEXT,title TEXT,last_visit_time INTEGER,hidden INTEGER); INSERT INTO urls VALUES('https://example.com/','Title',13300000000000000,0),('javascript:bad','Bad',13300000000000000,0),('https://hidden.test','Hidden',13300000000000000,1)", nullptr, nullptr, nullptr) == SQLITE_OK);
    sqlite3_close(db);
    auto entries = history(path, error);
    assert(error.isEmpty() && entries.size() == 1 && entries[0].toObject()["time"].toInteger() == 1655526400000LL);
    assert(!QFile::exists(path + "-journal"));
    auto i32 = [](int n) { QByteArray b(4, 0); qToLittleEndian<qint32>(n, b.data()); return b; };
    QByteArray session = "SNSS" + i32(3);
    auto command = [&](int id, QByteArray payload) { QByteArray len(2, 0); qToLittleEndian<quint16>(payload.size() + 1, len.data()); session += len + char(id) + payload; };
    auto navigation = [&](int tab, int index, QByteArray url) { auto data = i32(tab) + i32(index) + i32(url.size()) + url; while (data.size() % 4) data += '\0'; command(6, i32(data.size()) + data); };
    command(0, i32(1) + i32(10)); navigation(10, 0, "https://old.test"); navigation(10, 1, "https://current.test"); command(7, i32(10) + i32(1));
    command(0, i32(1) + i32(11)); navigation(11, 0, "https://closed.test"); command(16, i32(11)); command(255, {});
    auto opened = tabs(session, error);
    assert(error.isEmpty() && opened.size() == 1 && opened[0].toObject()["url"] == "https://current.test");
    QString encrypted_error; assert(tabs("SNSS" + i32(5), encrypted_error).isEmpty() && encrypted_error.contains("encrypted"));
    QString truncated_error; assert(tabs(session.chopped(1), truncated_error).isEmpty() && !truncated_error.isEmpty());
    puts("Chrome import: CSV, bookmarks, read-only history and session replay passed");
}
