#include <DerpBirdValueStore.h>
#include <AK/QuickSort.h>
#include <QTemporaryDir>
#include <QDir>
#include <chrono>
#include <cstdio>

int main()
{
    VERIFY(QDir().mkpath("artifacts"));
    QTemporaryDir temporary(QDir::currentPath() + "/artifacts/gm-values-bench-XXXXXX");
    VERIFY(temporary.isValid());
    auto path = temporary.path().toUtf8();
    using Clock = std::chrono::steady_clock;
    using Store = WebView::DerpBirdValueStore;
    for (bool full : { false, true }) {
        Database::Database::Options options;
        options.synchronous = full ? Database::Database::Synchronous::Full : Database::Database::Synchronous::Normal;
        auto db = MUST(Database::Database::create(ByteString(path.constData()), full ? "Full"sv : "Normal"sv, options));
        auto store = MUST(Store::create(move(db)));
        auto id = "benchmark"_string;
        Vector<Store::Update> seed;
        for (int i = 0; i < 256; ++i)
            seed.append({ MUST(String::formatted("key{}", i)), MUST(ByteBuffer::create_zeroed(1024)) });
        MUST(store->apply(id, seed));
        Vector<double> writes, reads;
        Array update { Store::Update { "counter"_string, MUST(ByteBuffer::copy("encoded-value"sv.bytes())) } };
        for (size_t i = 0; i < 300; ++i) {
            auto start = Clock::now();
            MUST(store->apply(id, update));
            writes.append(std::chrono::duration<double, std::micro>(Clock::now() - start).count());
            start = Clock::now();
            VERIFY(MUST(store->get(id, "counter"_string)).has_value());
            reads.append(std::chrono::duration<double, std::micro>(Clock::now() - start).count());
        }
        Vector<Store::Update> bulk;
        for (int i = 0; i < 256; ++i)
            bulk.append({ MUST(String::formatted("large{}", i)), MUST(ByteBuffer::create_zeroed(40000)) });
        MUST(store->apply("batch-benchmark"_string, bulk));
        MUST(store->apply("batch-benchmark"_string, update));
        Array selection { Store::Update { "counter"_string, {} } };
        Vector<double> selected_reads, snapshot_reads;
        for (size_t i = 0; i < 100; ++i) {
            auto start = Clock::now();
            auto selected = MUST(store->selected("batch-benchmark"_string, selection));
            selected_reads.append(std::chrono::duration<double, std::micro>(Clock::now() - start).count());
            VERIFY(selected.values.size() == 1 && selected.values[0].value.size() == 13);
            start = Clock::now();
            auto snapshot = MUST(store->snapshot("batch-benchmark"_string));
            snapshot_reads.append(std::chrono::duration<double, std::micro>(Clock::now() - start).count());
            VERIFY(snapshot.values.size() == 257 && snapshot.revision == selected.revision);
        }
        quick_sort(selected_reads); quick_sort(snapshot_reads);
        std::printf("{\"durability\":\"%s\",\"scope_payload_bytes\":10240013,\"samples\":100,\"selected_p95_us\":%.1f,\"snapshot_p95_us\":%.1f}\n",
            full ? "WAL-FULL" : "WAL-NORMAL", selected_reads[95], snapshot_reads[95]);
        quick_sort(writes); quick_sort(reads);
        std::printf("{\"durability\":\"%s\",\"samples\":300,\"write_p50_us\":%.1f,\"write_p95_us\":%.1f,\"write_max_us\":%.1f,\"read_p95_us\":%.1f}\n",
            full ? "WAL-FULL" : "WAL-NORMAL", writes[150], writes[285], writes.last(), reads[285]);
    }
}
