/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "ScrollbarDrawingGTK.h"

#include "mozilla/gfx/Helpers.h"
#include "mozilla/StaticPrefs_widget.h"
#include "nsLayoutUtils.h"
#include "nsNativeTheme.h"

#ifdef MOZ_WIDGET_GTK
#  include "gtkdrawing.h"
#endif

using namespace mozilla;
using namespace mozilla::gfx;
using namespace mozilla::widget;

LayoutDeviceIntSize ScrollbarDrawingGTK::GetMinimumWidgetSize(
    nsPresContext* aPresContext, StyleAppearance aAppearance,
    nsIFrame* aFrame) {
  MOZ_ASSERT(nsNativeTheme::IsWidgetScrollbarPart(aAppearance));
  auto scrollbarSize = GetScrollbarSize(aPresContext, aFrame);
  LayoutDeviceIntSize size{scrollbarSize, scrollbarSize};
  if (aAppearance == StyleAppearance::ScrollbarHorizontal ||
      aAppearance == StyleAppearance::ScrollbarVertical ||
      aAppearance == StyleAppearance::ScrollbartrackHorizontal ||
      aAppearance == StyleAppearance::ScrollbartrackVertical ||
      aAppearance == StyleAppearance::ScrollbarthumbHorizontal ||
      aAppearance == StyleAppearance::ScrollbarthumbVertical) {
    CSSCoord thumbSize(
        StaticPrefs::widget_non_native_theme_gtk_scrollbar_thumb_cross_size());
    const bool isVertical =
        aAppearance == StyleAppearance::ScrollbarVertical ||
        aAppearance == StyleAppearance::ScrollbartrackVertical ||
        aAppearance == StyleAppearance::ScrollbarthumbVertical;
    auto dpi = GetDPIRatioForScrollbarPart(aPresContext);
    if (isVertical) {
      size.height = thumbSize * dpi;
    } else {
      size.width = thumbSize * dpi;
    }
  }
  return size;
}

Maybe<nsITheme::Transparency> ScrollbarDrawingGTK::GetScrollbarPartTransparency(
    nsIFrame* aFrame, StyleAppearance aAppearance) {
  if (!nsLayoutUtils::UseOverlayScrollbars(aFrame) &&
      (aAppearance == StyleAppearance::ScrollbarVertical ||
       aAppearance == StyleAppearance::ScrollbarHorizontal ||
       aAppearance == StyleAppearance::ScrollbartrackVertical ||
       aAppearance == StyleAppearance::ScrollbartrackHorizontal) &&
      IsScrollbarTrackOpaque(aFrame)) {
    return Some(nsITheme::eOpaque);
  }

  return Nothing();
}

template <typename PaintBackendData>
bool ScrollbarDrawingGTK::DoPaintScrollbarThumb(
    PaintBackendData& aPaintData, const LayoutDeviceRect& aRect,
    ScrollbarKind aScrollbarKind, nsIFrame* aFrame, const ComputedStyle& aStyle,
    const ElementState& aElementState, const Colors& aColors,
    const DPIRatio& aDpiRatio) {
  sRGBColor thumbColor =
      ComputeScrollbarThumbColor(aFrame, aStyle, aElementState, aColors);

  LayoutDeviceRect thumbRect(aRect);

  const bool horizontal = aScrollbarKind == ScrollbarKind::Horizontal;
  if (nsLayoutUtils::UseOverlayScrollbars(aFrame) &&
      !ScrollbarDrawing::IsParentScrollbarHoveredOrActive(aFrame)) {
    if (horizontal) {
      thumbRect.height *= 0.5;
      thumbRect.y += thumbRect.height;
    } else {
      thumbRect.width *= 0.5;
      if (aScrollbarKind == ScrollbarKind::VerticalRight) {
        thumbRect.x += thumbRect.width;
      }
    }
  }

  {
    float factor = std::max(
        0.0f,
        1.0f - StaticPrefs::widget_non_native_theme_gtk_scrollbar_thumb_size());
    thumbRect.Deflate((horizontal ? thumbRect.height : thumbRect.width) *
                      factor);
  }

  LayoutDeviceCoord radius =
      StaticPrefs::widget_non_native_theme_gtk_scrollbar_round_thumb()
          ? (horizontal ? thumbRect.height : thumbRect.width) / 2.0f
          : 0.0f;

  ThemeDrawing::PaintRoundedRectWithRadius(aPaintData, thumbRect, thumbColor,
                                           sRGBColor(), 0, radius / aDpiRatio,
                                           aDpiRatio);
  return true;
}

bool ScrollbarDrawingGTK::PaintScrollbarThumb(
    DrawTarget& aDrawTarget, const LayoutDeviceRect& aRect,
    ScrollbarKind aScrollbarKind, nsIFrame* aFrame, const ComputedStyle& aStyle,
    const ElementState& aElementState, const Colors& aColors,
    const DPIRatio& aDpiRatio) {
  return DoPaintScrollbarThumb(aDrawTarget, aRect, aScrollbarKind, aFrame,
                               aStyle, aElementState, aColors, aDpiRatio);
}

bool ScrollbarDrawingGTK::PaintScrollbarThumb(
    WebRenderBackendData& aWrData, const LayoutDeviceRect& aRect,
    ScrollbarKind aScrollbarKind, nsIFrame* aFrame, const ComputedStyle& aStyle,
    const ElementState& aElementState, const Colors& aColors,
    const DPIRatio& aDpiRatio) {
  return DoPaintScrollbarThumb(aWrData, aRect, aScrollbarKind, aFrame, aStyle,
                               aElementState, aColors, aDpiRatio);
}

bool ScrollbarDrawingGTK::ShouldDrawScrollbarButtons() {
  if (StaticPrefs::widget_non_native_theme_enabled()) {
    return StaticPrefs::widget_non_native_theme_gtk_scrollbar_allow_buttons();
  }
  return true;
}

void ScrollbarDrawingGTK::RecomputeScrollbarParams() {
  uint32_t defaultSize = 12;
  uint32_t overlaySize = 0;
  uint32_t overrideSize =
      StaticPrefs::widget_non_native_theme_scrollbar_size_override();
  if (overrideSize > 0) {
    defaultSize = overrideSize;
  }
#ifdef MOZ_WIDGET_GTK
  else if (StaticPrefs::widget_native_controls_scrollbar_style() == 0) {
    // Native GTK drawing sizes the scrollbar parts from the GTK metrics, so
    // the scrollbar itself has to come from the same place or the box and its
    // contents disagree.
    const ScrollbarGTKMetrics* metrics =
        GetActiveScrollbarMetrics(GTK_ORIENTATION_VERTICAL);
    if (metrics->size.scrollbar.width > 0) {
      defaultSize = metrics->size.scrollbar.width;
    }
    const ScrollbarGTKMetrics* overlayMetrics =
        GetActiveScrollbarMetrics(GTK_ORIENTATION_VERTICAL, true);
    if (overlayMetrics->size.scrollbar.width > 0) {
      overlaySize = overlayMetrics->size.scrollbar.width;
    }
  }
#endif
  ConfigureScrollbarSize(defaultSize);
  if (overlaySize > 0) {
    ConfigureScrollbarSize(StyleScrollbarWidth::Auto, Overlay::Yes,
                           overlaySize);
    ConfigureScrollbarSize(StyleScrollbarWidth::Thin, Overlay::Yes,
                           overlaySize / 2);
  }
}
