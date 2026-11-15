#include <ContentSurfaceState.h>
#include <SurfacePixelCoverage.h>
#include <cstdlib>
#include <iostream>

static void check(bool condition, char const* message)
{
    if (!condition) {
        std::cerr << message << '\n';
        std::exit(EXIT_FAILURE);
    }
}

int main()
{
    using Ladybird::fully_covered_surface_pixels;
    check(fully_covered_surface_pixels(QRect(0, 0, 800, 600), QPointF(0, 74)) == QRect(0, 0, 800, 600), "Integer scale keeps exact coverage");
    check(fully_covered_surface_pixels(QRect(0, 0, 800, 600), QPointF(0, 74 * 1.6)) == QRect(0, 1, 800, 598), "Fractional top and bottom pixels need the current page background");
    check(fully_covered_surface_pixels(QRect(0, 0, 800, 600), QPointF(7 * 1.6, 7 * 1.6)) == QRect(1, 1, 798, 598), "Fractional origins on both axes leave all boundary pixels paintable");
    check(fully_covered_surface_pixels(QRect(0, 0, 1, 1), QPointF(.5, .5)).isEmpty(), "A partial pixel must not suppress background painting");
    Ladybird::ContentSurfaceState state;
    QRect bounds(0, 0, 1200, 800);
    check(!state.placement(bounds).visible(), "No content before the shell reports geometry");
    QRect viewport(226, 58, 966, 734);
    state.accept(viewport, {});
    auto initial = state.placement(bounds);
    check(initial.visible(), "An accepted content surface is visible");
    check(initial.viewport == viewport, "Preserve exact content coordinates");
    check(initial.visible_region == QRegion(QRect(0, 0, 966, 734)), "Mask uses content-local coordinates");

    state.accept(viewport, { QRect(900, 53, 280, 250) });
    auto menu = state.placement(bounds);
    check(!menu.visible_region.contains(QPoint(900 - 226, 60 - 58)), "Menu excludes overlapping native pixels");
    check(menu.visible_region.contains(QPoint(10, 10)), "Menu leaves the rest of the page visible");
    state.accept(viewport, { bounds });
    check(!state.placement(bounds).visible(), "Fully excluded content must hide, not use an empty QWidget mask");

    state.accept(viewport, {}, true);
    check(state.captures_input(), "A drag hands page input to the shell");
    check(state.placement(bounds).visible_region == initial.visible_region, "Input capture does not blank the page preview");
    state.invalidate();
    check(!state.captures_input(), "Navigation revokes input capture");
    check(!state.placement(bounds).visible(), "Navigation revokes old geometry");
    check(!state.placement(QRect(0, 0, 1600, 900)).visible(), "Resize cannot revive a stale document's geometry");
    state.accept(viewport, {});
    check(state.placement(bounds).visible(), "A recovered shell can restore the same geometry");
    auto smaller = state.placement(QRect(0, 0, 700, 500));
    check(smaller.viewport == QRect(226, 58, 474, 442), "Content clips to a smaller native window");
    check(!state.placement(QRect(0, 0, 100, 50)).visible(), "An offscreen viewport stays hidden");
    std::cout << "Content surface lifecycle checks passed\n";
}
