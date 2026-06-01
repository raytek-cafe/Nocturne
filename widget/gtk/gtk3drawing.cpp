/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * This file contains painting functions for each of the gtk2 widgets.
 * Adapted from the gtkdrawing.c, and gtk+2.0 source.
 */

#include <gtk/gtk.h>
#include <gdk/gdkprivate.h>
#include <string.h>
#include "gdk/gdk.h"
#include "gtkdrawing.h"
#include "mozilla/Attributes.h"
#include "mozilla/Assertions.h"
#include "mozilla/ScopeExit.h"
#include "prinrval.h"
#include "WidgetStyleCache.h"
#include "nsString.h"
#include "nsDebug.h"
#include "WidgetUtilsGtk.h"

#include <math.h>
#include <dlfcn.h>

static ToolbarGTKMetrics sToolbarMetrics;
MOZ_CONSTINIT static ScrollbarGTKMetrics sScrollbarMetrics[2] = {};
MOZ_CONSTINIT static ScrollbarGTKMetrics sActiveScrollbarMetrics[2] = {};

MOZ_CONSTINIT static ToggleGTKMetrics sCheckboxMetrics = {};
MOZ_CONSTINIT static ToggleGTKMetrics sRadioMetrics = {};
static GtkStateFlags checkbox_check_state = GTK_STATE_FLAG_CHECKED;

using mozilla::Span;

#if 0
// It's used for debugging only to compare Gecko widget style with
// the ones used by Gtk+ applications.
static void
style_path_print(GtkStyleContext *context)
{
    const GtkWidgetPath* path = gtk_style_context_get_path(context);

    static auto sGtkWidgetPathToStringPtr =
        (char * (*)(const GtkWidgetPath *))
        dlsym(RTLD_DEFAULT, "gtk_widget_path_to_string");

    fprintf(stderr, "Style path:\n%s\n\n", sGtkWidgetPathToStringPtr(path));
}
#endif

static constexpr gdouble ARROW_UP = 3.0 * G_PI / 2.0;
static constexpr gdouble ARROW_DOWN = G_PI / 2.0;
static constexpr gdouble ARROW_LEFT = G_PI;
static constexpr gdouble ARROW_RIGHT = 0.0;

static GtkBorder GetMarginBorderPadding(GtkStyleContext* aStyle) {
  GtkStateFlags state = gtk_style_context_get_state(aStyle);
  GtkBorder margin, border, padding;
  gtk_style_context_get_margin(aStyle, state, &margin);
  gtk_style_context_get_border(aStyle, state, &border);
  gtk_style_context_get_padding(aStyle, state, &padding);
  return {
      gint16(margin.left + border.left + padding.left),
      gint16(margin.right + border.right + padding.right),
      gint16(margin.top + border.top + padding.top),
      gint16(margin.bottom + border.bottom + padding.bottom),
  };
}

static MozGtkSize GetMinContentBox(GtkStyleContext* aStyle) {
  GtkStateFlags state = gtk_style_context_get_state(aStyle);
  gint width = 0;
  gint height = 0;
  gtk_style_context_get(aStyle, state, "min-width", &width, "min-height",
                        &height, nullptr);
  return {width, height};
}

static MozGtkSize GetMinMarginBox(GtkStyleContext* aStyle) {
  auto size = GetMinContentBox(aStyle);
  size += GetMarginBorderPadding(aStyle);
  return size;
}

static void Inset(GdkRectangle* aRect, const GtkBorder& aBorder) {
  aRect->x += aBorder.left;
  aRect->y += aBorder.top;
  aRect->width -= aBorder.left + aBorder.right;
  aRect->height -= aBorder.top + aBorder.bottom;
}

static void InsetByMargin(GdkRectangle* aRect, GtkStyleContext* aStyle) {
  GtkBorder margin;
  gtk_style_context_get_margin(aStyle, gtk_style_context_get_state(aStyle),
                               &margin);
  Inset(aRect, margin);
}

static void InsetByBorderPadding(GdkRectangle* aRect, GtkStyleContext* aStyle) {
  GtkStateFlags state = gtk_style_context_get_state(aStyle);
  GtkBorder padding, border;
  gtk_style_context_get_padding(aStyle, state, &padding);
  Inset(aRect, padding);
  gtk_style_context_get_border(aStyle, state, &border);
  Inset(aRect, border);
}

static gint moz_gtk_get_widget_min_size(GtkStyleContext* aStyle, int* aWidth,
                                        int* aHeight) {
  GtkStateFlags state = gtk_style_context_get_state(aStyle);
  gtk_style_context_get(aStyle, state, "min-height", aHeight, "min-width",
                        aWidth, nullptr);
  GtkBorder border, padding, margin;
  gtk_style_context_get_border(aStyle, state, &border);
  gtk_style_context_get_padding(aStyle, state, &padding);
  gtk_style_context_get_margin(aStyle, state, &margin);
  *aWidth += border.left + border.right + margin.left + margin.right +
             padding.left + padding.right;
  *aHeight += border.top + border.bottom + margin.top + margin.bottom +
              padding.top + padding.bottom;
  return MOZ_GTK_SUCCESS;
}

static void moz_gtk_draw_styled_frame(GtkStyleContext* aStyle, cairo_t* aCr,
                                      const GdkRectangle* aRect) {
  GdkRectangle rect = *aRect;
  InsetByMargin(&rect, aStyle);
  gtk_render_background(aStyle, aCr, rect.x, rect.y, rect.width, rect.height);
  gtk_render_frame(aStyle, aCr, rect.x, rect.y, rect.width, rect.height);
}

static gint moz_gtk_button_paint(cairo_t* aCr, const GtkDrawingParams& aParams,
                                 WidgetNodeType aWidget) {
  GtkStyleContext* style = GetStyleContext(aWidget, aParams.image_scale,
                                           aParams.direction, aParams.state);
  GdkRectangle rect = aParams.rect;
  moz_gtk_draw_styled_frame(style, aCr, &rect);
  if (aParams.state & GTK_STATE_FLAG_FOCUSED) {
    GtkBorder border;
    gtk_style_context_get_border(style, aParams.state, &border);
    rect.x += border.left;
    rect.y += border.top;
    rect.width -= border.left + border.right;
    rect.height -= border.top + border.bottom;
    gtk_render_focus(style, aCr, rect.x, rect.y, rect.width, rect.height);
  }
  return MOZ_GTK_SUCCESS;
}

static gint moz_gtk_toggle_paint(cairo_t* aCr, const GtkDrawingParams& aParams,
                                 bool aIsRadio) {
  GdkRectangle rect = aParams.rect;
  if (rect.width < rect.height) {
    rect.y += (rect.height - rect.width) / 2;
    rect.height = rect.width;
  } else if (rect.height < rect.width) {
    rect.x += (rect.width - rect.height) / 2;
    rect.width = rect.height;
  }

  GtkStateFlags state = aParams.state;
  if (aParams.flags & MOZ_GTK_WIDGET_CHECKED) {
    state = GtkStateFlags(state | checkbox_check_state);
  }
  if (aParams.flags & MOZ_GTK_WIDGET_INCONSISTENT) {
    state = GtkStateFlags(state | GTK_STATE_FLAG_INCONSISTENT);
  }

  auto node = aIsRadio ? MOZ_GTK_RADIOBUTTON : MOZ_GTK_CHECKBUTTON;
  GtkStyleContext* style =
      GetStyleContext(node, aParams.image_scale, aParams.direction, state);
  if (aIsRadio) {
    gtk_render_option(style, aCr, rect.x, rect.y, rect.width, rect.height);
  } else {
    gtk_render_check(style, aCr, rect.x, rect.y, rect.width, rect.height);
  }
  return MOZ_GTK_SUCCESS;
}

static gint moz_gtk_entry_paint(cairo_t* aCr, const GtkDrawingParams& aParams) {
  GtkStyleContext* style = GetStyleContext(MOZ_GTK_ENTRY, aParams.image_scale,
                                           aParams.direction, aParams.state);
  const auto& rect = aParams.rect;
  gtk_render_background(style, aCr, rect.x, rect.y, rect.width, rect.height);
  gtk_render_frame(style, aCr, rect.x, rect.y, rect.width, rect.height);
  return MOZ_GTK_SUCCESS;
}

static gint moz_gtk_text_view_paint(cairo_t* aCr,
                                    const GtkDrawingParams& aParams) {
  GtkStyleContext* frameStyle =
      GetStyleContext(MOZ_GTK_SCROLLED_WINDOW, aParams.image_scale,
                      aParams.direction, aParams.state);
  const auto& outer = aParams.rect;
  gtk_render_frame(frameStyle, aCr, outer.x, outer.y, outer.width,
                   outer.height);

  GdkRectangle rect = outer;
  InsetByBorderPadding(&rect, frameStyle);
  GtkStyleContext* style = GetStyleContext(
      MOZ_GTK_TEXT_VIEW, aParams.image_scale, aParams.direction, aParams.state);
  gtk_render_background(style, aCr, rect.x, rect.y, rect.width, rect.height);
  style = GetStyleContext(MOZ_GTK_TEXT_VIEW_TEXT, aParams.image_scale,
                          aParams.direction, aParams.state);
  gtk_render_background(style, aCr, rect.x, rect.y, rect.width, rect.height);
  return MOZ_GTK_SUCCESS;
}

static gint moz_gtk_treeview_paint(cairo_t* aCr,
                                   const GtkDrawingParams& aParams) {
  GtkStyleContext* frameStyle =
      GetStyleContext(MOZ_GTK_SCROLLED_WINDOW, aParams.image_scale,
                      aParams.direction, aParams.state);
  GtkBorder border;
  gtk_style_context_get_border(frameStyle, aParams.state, &border);

  const auto& rect = aParams.rect;
  GtkStyleContext* viewStyle =
      GetStyleContext(MOZ_GTK_TREEVIEW_VIEW, aParams.image_scale,
                      aParams.direction, aParams.state);
  gtk_render_background(viewStyle, aCr, rect.x + border.left,
                        rect.y + border.top,
                        rect.width - border.left - border.right,
                        rect.height - border.top - border.bottom);
  gtk_render_frame(frameStyle, aCr, rect.x, rect.y, rect.width, rect.height);
  return MOZ_GTK_SUCCESS;
}

static gint moz_gtk_combo_box_paint(cairo_t* aCr,
                                    const GtkDrawingParams& aParams) {
  const auto& rect = aParams.rect;
  GtkStyleContext* buttonStyle =
      GetStyleContext(MOZ_GTK_COMBOBOX_BUTTON, aParams.image_scale,
                      aParams.direction, aParams.state);
  gtk_render_background(buttonStyle, aCr, rect.x, rect.y, rect.width,
                        rect.height);
  gtk_render_frame(buttonStyle, aCr, rect.x, rect.y, rect.width, rect.height);

  GtkStyleContext* arrowStyle =
      GetStyleContext(MOZ_GTK_COMBOBOX_ARROW, aParams.image_scale,
                      aParams.direction, aParams.state);
  gint arrow = std::min(rect.width, rect.height) / 3;
  gint arrowX = aParams.direction == GTK_TEXT_DIR_RTL
                    ? rect.x + rect.width / 4
                    : rect.x + rect.width - arrow - rect.width / 4;
  gint arrowY = rect.y + (rect.height - arrow) / 2;
  gtk_render_arrow(arrowStyle, aCr, ARROW_DOWN, arrowX, arrowY, arrow);
  return MOZ_GTK_SUCCESS;
}

static gint moz_gtk_scale_paint(cairo_t* aCr, const GtkDrawingParams& aParams) {
  GtkStyleContext* style = GetStyleContext(aParams.widget, aParams.image_scale,
                                           aParams.direction, aParams.state);
  GdkRectangle rect = aParams.rect;
  GtkOrientation orientation = aParams.widget == MOZ_GTK_SCALE_HORIZONTAL
                                   ? GTK_ORIENTATION_HORIZONTAL
                                   : GTK_ORIENTATION_VERTICAL;
  GtkBorder margin;
  gtk_style_context_get_margin(style, aParams.state, &margin);
  if (orientation == GTK_ORIENTATION_HORIZONTAL) {
    rect.x += margin.left;
    rect.width -= margin.left + margin.right;
    rect.height = std::max(1, rect.height - margin.top - margin.bottom);
  } else {
    rect.y += margin.top;
    rect.height -= margin.top + margin.bottom;
    rect.width = std::max(1, rect.width - margin.left - margin.right);
  }
  gtk_render_background(style, aCr, rect.x, rect.y, rect.width, rect.height);
  gtk_render_frame(style, aCr, rect.x, rect.y, rect.width, rect.height);
  return MOZ_GTK_SUCCESS;
}

static gint moz_gtk_scale_thumb_paint(cairo_t* aCr,
                                      const GtkDrawingParams& aParams) {
  GtkStyleContext* style = GetStyleContext(aParams.widget, aParams.image_scale,
                                           aParams.direction, aParams.state);
  const auto& rect = aParams.rect;
  gtk_render_slider(style, aCr, rect.x, rect.y, rect.width, rect.height,
                    aParams.widget == MOZ_GTK_SCALE_THUMB_HORIZONTAL
                        ? GTK_ORIENTATION_HORIZONTAL
                        : GTK_ORIENTATION_VERTICAL);
  return MOZ_GTK_SUCCESS;
}

static gint moz_gtk_progressbar_paint(cairo_t* aCr,
                                      const GtkDrawingParams& aParams) {
  GtkStyleContext* style =
      GetStyleContext(MOZ_GTK_PROGRESS_TROUGH, aParams.image_scale,
                      aParams.direction, aParams.state);
  const auto& rect = aParams.rect;
  gtk_render_background(style, aCr, rect.x, rect.y, rect.width, rect.height);
  gtk_render_frame(style, aCr, rect.x, rect.y, rect.width, rect.height);
  return MOZ_GTK_SUCCESS;
}

static gint moz_gtk_progress_chunk_paint(cairo_t* aCr,
                                         const GtkDrawingParams& aParams) {
  GtkStyleContext* style =
      GetStyleContext(MOZ_GTK_PROGRESS_CHUNK, aParams.image_scale,
                      aParams.direction, aParams.state);
  const auto& rect = aParams.rect;
  gtk_render_background(style, aCr, rect.x, rect.y, rect.width, rect.height);
  gtk_render_frame(style, aCr, rect.x, rect.y, rect.width, rect.height);
  return MOZ_GTK_SUCCESS;
}

static void moz_gtk_update_scrollbar_style(GtkStyleContext* aStyle,
                                           WidgetNodeType aWidget,
                                           GtkTextDirection aDirection) {
  if (aWidget == MOZ_GTK_SCROLLBAR_HORIZONTAL) {
    gtk_style_context_add_class(aStyle, GTK_STYLE_CLASS_BOTTOM);
    return;
  }
  if (aDirection == GTK_TEXT_DIR_RTL) {
    gtk_style_context_add_class(aStyle, GTK_STYLE_CLASS_LEFT);
    gtk_style_context_remove_class(aStyle, GTK_STYLE_CLASS_RIGHT);
  } else {
    gtk_style_context_add_class(aStyle, GTK_STYLE_CLASS_RIGHT);
    gtk_style_context_remove_class(aStyle, GTK_STYLE_CLASS_LEFT);
  }
}

static gint moz_gtk_scrollbar_button_paint(cairo_t* aCr,
                                           const GtkDrawingParams& aParams) {
  const bool vertical = aParams.flags & MOZ_GTK_STEPPER_VERTICAL;
  const bool down = aParams.flags & MOZ_GTK_STEPPER_DOWN;
  const gdouble arrowAngle = vertical ? (down ? ARROW_DOWN : ARROW_UP)
                                      : (down ? ARROW_RIGHT : ARROW_LEFT);

  GtkStyleContext* style =
      GetStyleContext(MOZ_GTK_SCROLLBAR_BUTTON, aParams.image_scale,
                      aParams.direction, aParams.state);
  GdkRectangle rect = aParams.rect;
  moz_gtk_draw_styled_frame(style, aCr, &rect);

  gfloat arrowScaling = 0.7f;
  gtk_style_context_get_style(style, "arrow-scaling", &arrowScaling, nullptr);
  const gdouble arrowSize =
      std::min(rect.width, rect.height) * std::max(0.0f, arrowScaling);
  const gdouble arrowX = rect.x + (rect.width - arrowSize) / 2.0;
  const gdouble arrowY = rect.y + (rect.height - arrowSize) / 2.0;
  gtk_render_arrow(style, aCr, arrowAngle, arrowX, arrowY, arrowSize);
  return MOZ_GTK_SUCCESS;
}

static gint moz_gtk_scrollbar_trough_paint(cairo_t* aCr,
                                           const GtkDrawingParams& aParams) {
  GtkStyleContext* style = GetStyleContext(aParams.widget, aParams.image_scale,
                                           aParams.direction, aParams.state);
  GdkRectangle rect = aParams.rect;

  WidgetNodeType thumb = aParams.widget == MOZ_GTK_SCROLLBAR_TROUGH_VERTICAL
                             ? MOZ_GTK_SCROLLBAR_THUMB_VERTICAL
                             : MOZ_GTK_SCROLLBAR_THUMB_HORIZONTAL;
  MozGtkSize thumbSize = GetMinMarginBox(GetStyleContext(thumb));
  MozGtkSize trackSize = GetMinContentBox(style);
  trackSize.Include(thumbSize);
  trackSize += GetMarginBorderPadding(style);
  if (aParams.widget == MOZ_GTK_SCROLLBAR_TROUGH_VERTICAL) {
    rect.x += (rect.width - trackSize.width) / 2;
    rect.width = trackSize.width;
  } else {
    rect.y += (rect.height - trackSize.height) / 2;
    rect.height = trackSize.height;
  }

  moz_gtk_draw_styled_frame(style, aCr, &rect);
  return MOZ_GTK_SUCCESS;
}

static gint moz_gtk_scrollbar_paint(cairo_t* aCr,
                                    const GtkDrawingParams& aParams) {
  if (aParams.flags & MOZ_GTK_TRACK_OPAQUE) {
    GtkStyleContext* style = GetStyleContext(
        MOZ_GTK_WINDOW, aParams.image_scale, aParams.direction, aParams.state);
    const auto& rect = aParams.rect;
    gtk_render_background(style, aCr, rect.x, rect.y, rect.width, rect.height);
  }

  GtkStyleContext* style = GetStyleContext(aParams.widget, aParams.image_scale,
                                           aParams.direction, aParams.state);
  moz_gtk_update_scrollbar_style(style, aParams.widget, aParams.direction);
  moz_gtk_draw_styled_frame(style, aCr, &aParams.rect);

  GtkDrawingParams trough = aParams;
  trough.widget = aParams.widget == MOZ_GTK_SCROLLBAR_HORIZONTAL
                      ? MOZ_GTK_SCROLLBAR_TROUGH_HORIZONTAL
                      : MOZ_GTK_SCROLLBAR_TROUGH_VERTICAL;
  return moz_gtk_scrollbar_trough_paint(aCr, trough);
}

static gint moz_gtk_scrollbar_thumb_paint(cairo_t* aCr,
                                          const GtkDrawingParams& aParams) {
  GtkStyleContext* style = GetStyleContext(aParams.widget, aParams.image_scale,
                                           aParams.direction, aParams.state);
  GtkOrientation orientation =
      aParams.widget == MOZ_GTK_SCROLLBAR_THUMB_HORIZONTAL
          ? GTK_ORIENTATION_HORIZONTAL
          : GTK_ORIENTATION_VERTICAL;

  const ScrollbarGTKMetrics* metrics =
      (aParams.state & GTK_STATE_FLAG_PRELIGHT)
          ? GetActiveScrollbarMetrics(orientation)
          : GetScrollbarMetrics(orientation);
  GdkRectangle rect = aParams.rect;
  Inset(&rect, metrics->margin.thumb);
  gtk_render_slider(style, aCr, rect.x, rect.y, rect.width, rect.height,
                    orientation);
  return MOZ_GTK_SUCCESS;
}

static void InitScrollbarMetrics(ScrollbarGTKMetrics* aMetrics,
                                 GtkOrientation aOrientation,
                                 GtkStateFlags aStateFlags) {
  *aMetrics = {};
  WidgetNodeType scrollbar = aOrientation == GTK_ORIENTATION_HORIZONTAL
                                 ? MOZ_GTK_SCROLLBAR_HORIZONTAL
                                 : MOZ_GTK_SCROLLBAR_VERTICAL;
  GtkStyleContext* style =
      GetStyleContext(scrollbar, 1, GTK_TEXT_DIR_NONE, aStateFlags);
  gboolean backward = false, forward = false, secondaryBackward = false,
           secondaryForward = false;
  gtk_style_context_get_style(
      style, "has-backward-stepper", &backward, "has-forward-stepper", &forward,
      "has-secondary-backward-stepper", &secondaryBackward,
      "has-secondary-forward-stepper", &secondaryForward, nullptr);
  const bool hasButtons =
      backward || forward || secondaryBackward || secondaryForward;

  aMetrics->border.scrollbar = GetMarginBorderPadding(style);

  WidgetNodeType contents = aOrientation == GTK_ORIENTATION_HORIZONTAL
                                ? MOZ_GTK_SCROLLBAR_CONTENTS_HORIZONTAL
                                : MOZ_GTK_SCROLLBAR_CONTENTS_VERTICAL;
  WidgetNodeType track = aOrientation == GTK_ORIENTATION_HORIZONTAL
                             ? MOZ_GTK_SCROLLBAR_TROUGH_HORIZONTAL
                             : MOZ_GTK_SCROLLBAR_TROUGH_VERTICAL;
  WidgetNodeType thumb = aOrientation == GTK_ORIENTATION_HORIZONTAL
                             ? MOZ_GTK_SCROLLBAR_THUMB_HORIZONTAL
                             : MOZ_GTK_SCROLLBAR_THUMB_VERTICAL;

  style =
      CreateStyleContextWithStates(thumb, 1, GTK_TEXT_DIR_NONE, aStateFlags);
  aMetrics->size.thumb = GetMinMarginBox(style);
  gtk_style_context_get_margin(style, gtk_style_context_get_state(style),
                               &aMetrics->margin.thumb);
  g_object_unref(style);

  style =
      CreateStyleContextWithStates(track, 1, GTK_TEXT_DIR_NONE, aStateFlags);
  aMetrics->border.track = GetMarginBorderPadding(style);
  MozGtkSize trackMinSize = GetMinContentBox(style) + aMetrics->border.track;
  MozGtkSize trackSizeForThumb = aMetrics->size.thumb + aMetrics->border.track;
  g_object_unref(style);

  if (hasButtons) {
    style = CreateStyleContextWithStates(MOZ_GTK_SCROLLBAR_BUTTON, 1,
                                         GTK_TEXT_DIR_NONE, aStateFlags);
    aMetrics->size.button = GetMinMarginBox(style);
    g_object_unref(style);
  }

  if (aOrientation == GTK_ORIENTATION_HORIZONTAL) {
    aMetrics->size.button.Rotate();
    gint extra = std::max(trackMinSize.height, aMetrics->size.button.height) -
                 trackSizeForThumb.height;
    if (extra > 0) {
      aMetrics->border.track.top += extra / 2;
      aMetrics->border.track.bottom += extra - extra / 2;
      trackSizeForThumb.height += extra;
    }
  } else {
    gint extra = std::max(trackMinSize.width, aMetrics->size.button.width) -
                 trackSizeForThumb.width;
    if (extra > 0) {
      aMetrics->border.track.left += extra / 2;
      aMetrics->border.track.right += extra - extra / 2;
      trackSizeForThumb.width += extra;
    }
  }

  style =
      CreateStyleContextWithStates(contents, 1, GTK_TEXT_DIR_NONE, aStateFlags);
  GtkBorder contentsBorder = GetMarginBorderPadding(style);
  g_object_unref(style);
  aMetrics->size.scrollbar =
      trackSizeForThumb + contentsBorder + aMetrics->border.scrollbar;
  aMetrics->initialized = true;
}

void moz_gtk_init() {
  checkbox_check_state = gtk_check_version(3, 14, 0) == nullptr
                             ? GTK_STATE_FLAG_CHECKED
                             : GTK_STATE_FLAG_ACTIVE;
  moz_gtk_refresh();
}

void moz_gtk_refresh() {
  sCheckboxMetrics = {};
  sRadioMetrics = {};
  sToolbarMetrics.initialized = false;
  sScrollbarMetrics[GTK_ORIENTATION_HORIZONTAL] = {};
  sScrollbarMetrics[GTK_ORIENTATION_VERTICAL] = {};
  sActiveScrollbarMetrics[GTK_ORIENTATION_HORIZONTAL] = {};
  sActiveScrollbarMetrics[GTK_ORIENTATION_VERTICAL] = {};
  ResetWidgetCache();
}

const ScrollbarGTKMetrics* GetActiveScrollbarMetrics(
    GtkOrientation aOrientation) {
  auto* metrics = &sActiveScrollbarMetrics[aOrientation];
  if (!metrics->initialized) {
    InitScrollbarMetrics(metrics, aOrientation, GTK_STATE_FLAG_PRELIGHT);
  }
  return metrics;
}

const ScrollbarGTKMetrics* GetScrollbarMetrics(GtkOrientation aOrientation) {
  auto* metrics = &sScrollbarMetrics[aOrientation];
  if (!metrics->initialized) {
    InitScrollbarMetrics(metrics, aOrientation, GTK_STATE_FLAG_NORMAL);
    const ScrollbarGTKMetrics* active = GetActiveScrollbarMetrics(aOrientation);
    if (metrics->size.thumb < active->size.thumb) {
      metrics->margin.thumb.left +=
          metrics->border.scrollbar.left + metrics->border.track.left -
          active->border.scrollbar.left - active->border.track.left;
      metrics->margin.thumb.right +=
          metrics->border.scrollbar.right + metrics->border.track.right -
          active->border.scrollbar.right - active->border.track.right;
      metrics->margin.thumb.top +=
          metrics->border.scrollbar.top + metrics->border.track.top -
          active->border.scrollbar.top - active->border.track.top;
      metrics->margin.thumb.bottom +=
          metrics->border.scrollbar.bottom + metrics->border.track.bottom -
          active->border.scrollbar.bottom - active->border.track.bottom;
    }
  }
  return metrics;
}

const ToggleGTKMetrics* GetToggleMetrics(WidgetNodeType aWidgetType) {
  ToggleGTKMetrics* metrics =
      aWidgetType == MOZ_GTK_RADIOBUTTON ? &sRadioMetrics : &sCheckboxMetrics;
  if (!metrics->initialized) {
    metrics->initialized = true;
    GtkStyleContext* style = GetStyleContext(aWidgetType);
    int width = 0;
    int height = 0;
    moz_gtk_get_widget_min_size(style, &width, &height);
    metrics->minSizeWithBorder = {gint(width), gint(height)};
    GtkStateFlags state = gtk_style_context_get_state(style);
    GtkBorder border, padding;
    gtk_style_context_get_border(style, state, &border);
    gtk_style_context_get_padding(style, state, &padding);
    metrics->borderAndPadding = {gint16(border.left + padding.left),
                                 gint16(border.right + padding.right),
                                 gint16(border.top + padding.top),
                                 gint16(border.bottom + padding.bottom)};
  }
  return metrics;
}

void moz_gtk_get_scale_metrics(GtkOrientation aOrientation, gint* aScaleWidth,
                               gint* aScaleHeight) {
  auto node = aOrientation == GTK_ORIENTATION_HORIZONTAL
                  ? MOZ_GTK_SCALE_TROUGH_HORIZONTAL
                  : MOZ_GTK_SCALE_TROUGH_VERTICAL;
  int width = 0;
  int height = 0;
  moz_gtk_get_widget_min_size(GetStyleContext(node), &width, &height);
  *aScaleWidth = width;
  *aScaleHeight = height;
}

gint moz_gtk_get_scalethumb_metrics(GtkOrientation aOrientation,
                                    gint* aThumbLength, gint* aThumbHeight) {
  auto node = aOrientation == GTK_ORIENTATION_HORIZONTAL
                  ? MOZ_GTK_SCALE_THUMB_HORIZONTAL
                  : MOZ_GTK_SCALE_THUMB_VERTICAL;
  int width = 0;
  int height = 0;
  moz_gtk_get_widget_min_size(GetStyleContext(node), &width, &height);
  *aThumbLength = width;
  *aThumbHeight = height;
  return MOZ_GTK_SUCCESS;
}

void moz_gtk_get_entry_min_height(gint* aMinContentHeight,
                                  gint* aBorderPaddingHeight) {
  GtkStyleContext* style = GetStyleContext(MOZ_GTK_ENTRY);
  GtkStateFlags state = gtk_style_context_get_state(style);
  gtk_style_context_get(style, state, "min-height", aMinContentHeight, nullptr);
  GtkBorder border, padding;
  gtk_style_context_get_border(style, state, &border);
  gtk_style_context_get_padding(style, state, &padding);
  *aBorderPaddingHeight =
      border.top + border.bottom + padding.top + padding.bottom;
}

size_t GetGtkHeaderBarButtonLayout(Span<ButtonLayout> aButtonLayout,
                                   bool* aReversedButtonsPlacement) {
  gchar* decorationLayoutSetting = nullptr;
  GtkSettings* settings = gtk_settings_get_default();
  g_object_get(settings, "gtk-decoration-layout", &decorationLayoutSetting,
               nullptr);
  auto free = mozilla::MakeScopeExit([&] { g_free(decorationLayoutSetting); });

  // Use a default layout
  const gchar* decorationLayout = "menu:minimize,maximize,close";
  if (decorationLayoutSetting) {
    decorationLayout = decorationLayoutSetting;
  }

  if (aReversedButtonsPlacement) {
    const char* closeButton = strstr(decorationLayout, "close");
    const char* separator = strchr(decorationLayout, ':');
    *aReversedButtonsPlacement =
        closeButton && separator && closeButton < separator;
  }

  if (aButtonLayout.IsEmpty()) {
    return 0;
  }

  nsDependentCSubstring layout(decorationLayout, strlen(decorationLayout));
  size_t activeButtons = 0;
  for (const auto& part : layout.Split(':')) {
    for (const auto& button : part.Split(',')) {
      if (button.EqualsLiteral("close")) {
        aButtonLayout[activeButtons++] = {ButtonLayout::Type::Close};
      } else if (button.EqualsLiteral("minimize")) {
        aButtonLayout[activeButtons++] = {ButtonLayout::Type::Minimize};
      } else if (button.EqualsLiteral("maximize")) {
        aButtonLayout[activeButtons++] = {ButtonLayout::Type::Maximize};
      }
      if (activeButtons == aButtonLayout.Length()) {
        return activeButtons;
      }
    }
  }
  return activeButtons;
}

static void EnsureToolbarMetrics() {
  if (sToolbarMetrics.initialized) {
    return;
  }
  sToolbarMetrics = {};
  gint spacing = 6;
  g_object_get(GetWidget(MOZ_GTK_HEADER_BAR), "spacing", &spacing, nullptr);
  sToolbarMetrics.inlineSpacing += spacing;
  sToolbarMetrics.initialized = true;
}

gint moz_gtk_get_titlebar_button_spacing() {
  EnsureToolbarMetrics();
  return sToolbarMetrics.inlineSpacing;
}

static void moz_gtk_window_decoration_paint(cairo_t* aCr,
                                            const GtkDrawingParams& aParams) {
  if (mozilla::widget::GdkIsWaylandDisplay()) {
    return;
  }
  GtkStyleContext* windowStyle =
      GetStyleContext(MOZ_GTK_HEADERBAR_WINDOW, aParams.image_scale);
  const bool solidDecorations =
      gtk_style_context_has_class(windowStyle, "solid-csd");
  GtkStyleContext* decorationStyle =
      GetStyleContext(solidDecorations ? MOZ_GTK_WINDOW_DECORATION_SOLID
                                       : MOZ_GTK_WINDOW_DECORATION,
                      aParams.image_scale, aParams.direction, aParams.state);

  const auto& rect = aParams.rect;
  gtk_render_background(decorationStyle, aCr, rect.x, rect.y, rect.width,
                        rect.height);
  gtk_render_frame(decorationStyle, aCr, rect.x, rect.y, rect.width,
                   rect.height);
}

gint moz_gtk_get_widget_border(WidgetNodeType aWidget, gint* aLeft, gint* aTop,
                               gint* aRight, gint* aBottom,
                               GtkTextDirection aDirection) {
  *aLeft = *aTop = *aRight = *aBottom = 0;
  switch (aWidget) {
    case MOZ_GTK_BUTTON:
    case MOZ_GTK_TOGGLE_BUTTON:
    case MOZ_GTK_ENTRY:
    case MOZ_GTK_DROPDOWN:
    case MOZ_GTK_PROGRESSBAR:
    case MOZ_GTK_TREEVIEW:
    case MOZ_GTK_SCALE_HORIZONTAL:
    case MOZ_GTK_SCALE_VERTICAL:
    case MOZ_GTK_SCALE_TROUGH_HORIZONTAL:
    case MOZ_GTK_SCALE_TROUGH_VERTICAL:
    case MOZ_GTK_SCROLLBAR_HORIZONTAL:
    case MOZ_GTK_SCROLLBAR_VERTICAL:
    case MOZ_GTK_SCROLLBAR_TROUGH_HORIZONTAL:
    case MOZ_GTK_SCROLLBAR_TROUGH_VERTICAL: {
      GtkStyleContext* style = GetStyleContext(aWidget, 1, aDirection);
      const GtkBorder border = GetMarginBorderPadding(style);
      *aLeft = border.left;
      *aTop = border.top;
      *aRight = border.right;
      *aBottom = border.bottom;
      return MOZ_GTK_SUCCESS;
    }
    case MOZ_GTK_CHECKBUTTON:
    case MOZ_GTK_RADIOBUTTON:
    case MOZ_GTK_PROGRESS_CHUNK:
    case MOZ_GTK_PROGRESS_CHUNK_INDETERMINATE:
    case MOZ_GTK_PROGRESS_CHUNK_VERTICAL_INDETERMINATE:
    case MOZ_GTK_SCALE_THUMB_HORIZONTAL:
    case MOZ_GTK_SCALE_THUMB_VERTICAL:
    case MOZ_GTK_SCROLLBAR_BUTTON:
    case MOZ_GTK_SCROLLBAR_THUMB_HORIZONTAL:
    case MOZ_GTK_SCROLLBAR_THUMB_VERTICAL:
      return MOZ_GTK_SUCCESS;
    default:
      return MOZ_GTK_UNKNOWN_WIDGET;
  }
}

/* cairo_t *cr argument has to be a system-cairo. */
void moz_gtk_widget_paint(cairo_t* aCr, const GtkDrawingParams* aParams) {
  cairo_new_path(aCr);
  switch (aParams->widget) {
    case MOZ_GTK_BUTTON:
      mozilla::Unused << moz_gtk_button_paint(aCr, *aParams, MOZ_GTK_BUTTON);
      return;
    case MOZ_GTK_CHECKBUTTON:
      mozilla::Unused << moz_gtk_toggle_paint(aCr, *aParams, false);
      return;
    case MOZ_GTK_RADIOBUTTON:
      mozilla::Unused << moz_gtk_toggle_paint(aCr, *aParams, true);
      return;
    case MOZ_GTK_ENTRY:
      mozilla::Unused << moz_gtk_entry_paint(aCr, *aParams);
      return;
    case MOZ_GTK_TEXT_VIEW:
      mozilla::Unused << moz_gtk_text_view_paint(aCr, *aParams);
      return;
    case MOZ_GTK_DROPDOWN:
      mozilla::Unused << moz_gtk_combo_box_paint(aCr, *aParams);
      return;
    case MOZ_GTK_TREEVIEW:
      mozilla::Unused << moz_gtk_treeview_paint(aCr, *aParams);
      return;
    case MOZ_GTK_PROGRESSBAR:
      mozilla::Unused << moz_gtk_progressbar_paint(aCr, *aParams);
      return;
    case MOZ_GTK_PROGRESS_CHUNK:
    case MOZ_GTK_PROGRESS_CHUNK_INDETERMINATE:
    case MOZ_GTK_PROGRESS_CHUNK_VERTICAL_INDETERMINATE:
      mozilla::Unused << moz_gtk_progress_chunk_paint(aCr, *aParams);
      return;
    case MOZ_GTK_SCALE_HORIZONTAL:
    case MOZ_GTK_SCALE_VERTICAL:
      mozilla::Unused << moz_gtk_scale_paint(aCr, *aParams);
      return;
    case MOZ_GTK_SCALE_THUMB_HORIZONTAL:
    case MOZ_GTK_SCALE_THUMB_VERTICAL:
      mozilla::Unused << moz_gtk_scale_thumb_paint(aCr, *aParams);
      return;
    case MOZ_GTK_SCROLLBAR_BUTTON:
      mozilla::Unused << moz_gtk_scrollbar_button_paint(aCr, *aParams);
      return;
    case MOZ_GTK_SCROLLBAR_HORIZONTAL:
    case MOZ_GTK_SCROLLBAR_VERTICAL:
      mozilla::Unused << moz_gtk_scrollbar_paint(aCr, *aParams);
      return;
    case MOZ_GTK_SCROLLBAR_TROUGH_HORIZONTAL:
    case MOZ_GTK_SCROLLBAR_TROUGH_VERTICAL:
      mozilla::Unused << moz_gtk_scrollbar_trough_paint(aCr, *aParams);
      return;
    case MOZ_GTK_SCROLLBAR_THUMB_HORIZONTAL:
    case MOZ_GTK_SCROLLBAR_THUMB_VERTICAL:
      mozilla::Unused << moz_gtk_scrollbar_thumb_paint(aCr, *aParams);
      return;
    case MOZ_GTK_WINDOW_DECORATION:
    case MOZ_GTK_WINDOW_DECORATION_SOLID:
      return moz_gtk_window_decoration_paint(aCr, *aParams);
    default:
      g_warning("Unknown widget type: %d", aParams->widget);
      return;
  }
}

gint moz_gtk_shutdown() {
  ResetWidgetCache();
  return MOZ_GTK_SUCCESS;
}