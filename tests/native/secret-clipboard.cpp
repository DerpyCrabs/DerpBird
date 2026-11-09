#include <DerpBirdSecretClipboard.h>
#include <QEventLoop>
#include <QWidget>
#include <QApplication>
#include <cstdio>
#include <cstdlib>

static void check(bool value) { if (!value) std::abort(); }
static void wait(int ms) { QEventLoop loop; QTimer::singleShot(ms, &loop, &QEventLoop::quit); loop.exec(); }
class TestWindow final : public QWidget {
    bool event(QEvent* event) override
    {
        if (event->type() != QEvent::KeyPress || m_started) return QWidget::event(event);
        m_started = true;
        QTimer::singleShot(0, this, [] {
            auto* clipboard = QGuiApplication::clipboard();
            {
                Ladybird::DerpBirdSecretClipboard owner(nullptr, 100);
                check(owner.publish(QStringLiteral("fixture-first"), owner.ticket()));
                check(clipboard->text() == QStringLiteral("fixture-first"));
                wait(200);
                check(clipboard->text().isEmpty());
                auto stale = owner.ticket();
                clipboard->setText(QStringLiteral("newer-user-copy"));
                check(!owner.publish(QStringLiteral("must-not-overwrite"), stale));
                check(clipboard->text() == QStringLiteral("newer-user-copy"));
                check(owner.publish(QStringLiteral("fixture-second"), owner.ticket()));
                clipboard->setText(QStringLiteral("keep-this"));
                wait(200);
                check(clipboard->text() == QStringLiteral("keep-this"));
                check(owner.publish(QStringLiteral("fixture-third"), owner.ticket()));
                check(owner.publish(QStringLiteral("fixture-fourth"), owner.ticket()));
                check(clipboard->text() == QStringLiteral("fixture-fourth"));
            }
            check(clipboard->text().isEmpty());
            std::puts("PASS: Wayland secret clipboard expiry, stale ticket, newer copy preservation and destruction");
            QCoreApplication::quit();
        });
        return true;
    }
    bool m_started { false };
};
int main(int argc, char** argv)
{
    QApplication app(argc, argv);
    check(QGuiApplication::platformName().startsWith("wayland"));
    TestWindow window;
    window.resize(640, 240); window.setWindowTitle("DerpBird clipboard test: press a key"); window.show(); window.activateWindow();
    QTimer::singleShot(30000, &app, [] { std::fputs("Timed out waiting for clipboard test input/completion\n", stderr); std::abort(); });
    return app.exec();
}
