/* vim: se cin sw=2 ts=2 et : */
/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include <algorithm>

#include "mozilla/ArrayUtils.h"
#include "mozilla/WindowsVersion.h"

#include "nsUXThemeData.h"
#include "nsDebug.h"
#include "nsToolkit.h"
#include "nsUXThemeConstants.h"
#include "gfxWindowsPlatform.h"

// -- native controls patch includes --
#include "mozilla/StaticPrefs_widget.h"
// -- end native controls patch includes --

using namespace mozilla;
using namespace mozilla::widget;

const wchar_t
nsUXThemeData::kThemeLibraryName[] = L"uxtheme.dll";

constinit nsUXThemeData::ThemeHandle nsUXThemeData::sThemes[eUXNumClasses];

HMODULE
nsUXThemeData::sThemeDLL = nullptr;

const int NUM_COMMAND_BUTTONS = 3;
SIZE nsUXThemeData::sCommandButtonMetrics[NUM_COMMAND_BUTTONS];
bool nsUXThemeData::sCommandButtonMetricsInitialized = false;
SIZE nsUXThemeData::sCommandButtonBoxMetrics;
bool nsUXThemeData::sCommandButtonBoxMetricsInitialized = false;
Maybe<SIZE> nsUXThemeData::sNativeAeroButtonSize;
float nsUXThemeData::sNativeAeroButtonDpi = 0;

bool nsUXThemeData::sTitlebarInfoPopulatedAero = false;
bool nsUXThemeData::sTitlebarInfoPopulatedThemed = false;

/**
 * Windows themes we currently detect.
 */
enum class WindowsTheme {
  Generic = 0,  // unrecognized theme
  Classic,
  Aero,
  Luna,
  Royale,
  Zune,
  AeroLite
};

static WindowsTheme sThemeId = WindowsTheme::Generic;

nsUXThemeData::ThemeHandle::~ThemeHandle() { Close(); }

void nsUXThemeData::ThemeHandle::OpenOnce(HWND aWindow, LPCWSTR aClassList) {
  if (mHandle.isSome()) {
    return;
  }

  mHandle = Some(OpenThemeData(aWindow, aClassList));
}

void nsUXThemeData::ThemeHandle::Close() {
  if (mHandle.isNothing()) {
    return;
  }

  if (HANDLE rawHandle = mHandle.extract()) {
    CloseThemeData(rawHandle);
  }
}

nsUXThemeData::ThemeHandle::operator HANDLE() {
  return mHandle.valueOr(nullptr);
}

void nsUXThemeData::Invalidate() {
  for (auto& theme : sThemes) {
    theme.Close();
  }
}

HANDLE
nsUXThemeData::GetTheme(nsUXThemeClass cls) {
  NS_ASSERTION(cls < eUXNumClasses, "Invalid theme class!");
  sThemes[cls].OpenOnce(nullptr, GetClassName(cls));
  return sThemes[cls];
}

HMODULE
nsUXThemeData::GetThemeDLL() {
  if (!sThemeDLL)
    sThemeDLL = ::LoadLibraryW(kThemeLibraryName);
  return sThemeDLL;
}

const wchar_t* nsUXThemeData::GetClassName(nsUXThemeClass cls) {
  switch (cls) {
    case eUXButton:
      return L"Button";
    case eUXEdit:
      return L"Edit";
    case eUXTooltip:
      return L"Tooltip";
    case eUXRebar:
      return L"Rebar";
    case eUXMediaRebar:
      return L"Media::Rebar";
    case eUXCommunicationsRebar:
      return L"Communications::Rebar";
    case eUXBrowserTabBarRebar:
      return L"BrowserTabBar::Rebar";
    case eUXScrollbar:
      return L"Scrollbar";
    case eUXToolbar:
      return L"Toolbar";
    case eUXMediaToolbar:
      return L"Media::Toolbar";
    case eUXCommunicationsToolbar:
      return L"Communications::Toolbar";
    case eUXProgress:
      return L"Progress";
    case eUXTab:
      return L"Tab";
    case eUXTrackbar:
      return L"Trackbar";
    case eUXSpin:
      return L"Spin";
    case eUXStatus:
      return L"Status";
    case eUXCombobox:
      return L"Combobox";
    case eUXHeader:
      return L"Header";
    case eUXListview:
      return L"Listview";
    case eUXMenu:
      return L"Menu";
    case eUXWindowFrame:
      return L"Window";
    default:
      MOZ_ASSERT_UNREACHABLE("unknown uxtheme class");
      return L"";
  }
}

// static
void nsUXThemeData::EnsureCommandButtonMetrics() {
  if (sCommandButtonMetricsInitialized) {
    return;
  }
  sCommandButtonMetricsInitialized = true;

  // This code should never need to be evaluated for our UI since if we need
  // these metrics for our UI we should make sure that we obtain the correct
  // metrics when nsWindow::Create() is called.  The generic metrics that we
  // fetch here will likley not match the current theme, but we provide these
  // values in case arbitrary content is styled with the '-moz-appearance'
  // value '-moz-window-button-close' etc.
  //
  // ISSUE: We'd prefer to use MOZ_ASSERT_UNREACHABLE here, but since content
  // (and at least one of our crashtests) can use '-moz-window-button-close'
  // we need to use NS_WARNING instead.
  NS_WARNING("Making expensive and likely unnecessary GetSystemMetrics calls");

  sCommandButtonMetrics[0].cx = GetSystemMetrics(SM_CXSIZE);
  sCommandButtonMetrics[0].cy = GetSystemMetrics(SM_CYSIZE);
  sCommandButtonMetrics[1].cx = sCommandButtonMetrics[2].cx =
      sCommandButtonMetrics[0].cx;
  sCommandButtonMetrics[1].cy = sCommandButtonMetrics[2].cy =
      sCommandButtonMetrics[0].cy;

  // Use system metrics for pre-vista, otherwise trigger a
  // refresh on the next layout.
  sTitlebarInfoPopulatedAero = sTitlebarInfoPopulatedThemed =
    !IsVistaOrLater();
}

// static
void nsUXThemeData::EnsureCommandButtonBoxMetrics() {
  if (sCommandButtonBoxMetricsInitialized) {
    return;
  }
  sCommandButtonBoxMetricsInitialized = true;

  EnsureCommandButtonMetrics();

  sCommandButtonBoxMetrics.cx = sCommandButtonMetrics[0].cx +
                                sCommandButtonMetrics[1].cx +
                                sCommandButtonMetrics[2].cx;
  sCommandButtonBoxMetrics.cy =
      std::max({sCommandButtonMetrics[0].cy, sCommandButtonMetrics[1].cy,
                sCommandButtonMetrics[2].cy});

  // Trigger a refresh on the next layout.
  sTitlebarInfoPopulatedAero = sTitlebarInfoPopulatedThemed = false;
}

// static
Maybe<RECT> nsUXThemeData::GetNativeAeroButtonBounds(HWND aWnd) {
  TITLEBARINFOEX info = {};
  info.cbSize = sizeof(info);
  // The widget's message handler can describe Gecko's Basic buttons.
  ::DefWindowProcW(aWnd, WM_GETTITLEBARINFOEX, 0,
                   reinterpret_cast<LPARAM>(&info));
  RECT bounds = info.rgrect[2];
  for (const int index : {2, 3, 5}) {
    const RECT& rect = info.rgrect[index];
    if ((info.rgstate[index] &
         (STATE_SYSTEM_INVISIBLE | STATE_SYSTEM_OFFSCREEN)) ||
        rect.right <= rect.left || rect.bottom <= rect.top) {
      return Nothing();
    }
    bounds.left = std::min(bounds.left, rect.left);
    bounds.top = std::min(bounds.top, rect.top);
    bounds.right = std::max(bounds.right, rect.right);
    bounds.bottom = std::max(bounds.bottom, rect.bottom);
  }
  const float dpi =
      WinUtils::MonitorDPI(::MonitorFromWindow(aWnd, MONITOR_DEFAULTTONEAREST));
  if (!::IsZoomed(aWnd)) {
    sNativeAeroButtonSize =
        Some(SIZE{bounds.right - bounds.left, bounds.bottom - bounds.top});
    sNativeAeroButtonDpi = dpi;
    return Some(bounds);
  }

  if (!sNativeAeroButtonSize || sNativeAeroButtonDpi != dpi) {
    RECT client;
    POINT position = {};
    if (!::GetClientRect(aWnd, &client) ||
        !::ClientToScreen(aWnd, &position)) {
      return Nothing();
    }
    const int borderX =
        WinUtils::GetSystemMetricsForDpi(SM_CXFRAME, UINT(dpi)) +
        WinUtils::GetSystemMetricsForDpi(SM_CXPADDEDBORDER, UINT(dpi));
    const int borderY =
        WinUtils::GetSystemMetricsForDpi(SM_CYFRAME, UINT(dpi)) +
        WinUtils::GetSystemMetricsForDpi(SM_CXPADDEDBORDER, UINT(dpi));
    position.x += borderX;
    position.y += borderY;
    const int width = client.right - client.left - 2 * borderX;
    const int height = client.bottom - client.top - 2 * borderY;
    if (width <= 0 || height <= 0) {
      return Nothing();
    }
    HWND probe = ::CreateWindowExW(
        WS_EX_NOACTIVATE, L"STATIC", L"", WS_OVERLAPPEDWINDOW, position.x,
        position.y, width, height, nullptr, nullptr, nullptr, nullptr);
    if (!probe) {
      return Nothing();
    }
    Maybe<RECT> normalBounds;
    if (::SetWindowPos(probe, aWnd, position.x, position.y, width, height,
                       SWP_NOACTIVATE | SWP_SHOWWINDOW)) {
      normalBounds = GetNativeAeroButtonBounds(probe);
    }
    ::DestroyWindow(probe);
    if (!normalBounds || !sNativeAeroButtonSize ||
        sNativeAeroButtonDpi != dpi) {
      return Nothing();
    }
  }

  // Maximized accessibility bounds clip the top and include the right frame.
  bounds.right = bounds.left + sNativeAeroButtonSize->cx;
  bounds.top = bounds.bottom - sNativeAeroButtonSize->cy;
  return Some(bounds);
}

// static
void nsUXThemeData::UpdateTitlebarInfo(HWND aWnd) {
  if (!aWnd) return;

  bool dwmCompositionEnabled =
      StaticPrefs::widget_native_controls_force_dwm_report_off()
          ? false
          : gfxWindowsPlatform::GetPlatform()->DwmCompositionEnabled();

  if (!sTitlebarInfoPopulatedAero && dwmCompositionEnabled &&
      ::IsWindowVisible(aWnd) && !::IsIconic(aWnd)) {
    Maybe<SIZE> buttonBoxMetrics;
    if (StaticPrefs::widget_native_controls_override_win_version() < 10) {
      if (auto bounds = GetNativeAeroButtonBounds(aWnd)) {
        buttonBoxMetrics = Some(SIZE{
            bounds->right - bounds->left,
            bounds->bottom - bounds->top + GetSystemMetrics(SM_CYFRAME) +
                GetSystemMetrics(SM_CXPADDEDBORDER)});
      }
    }
    int overrideCaptionButtonsWidth = StaticPrefs::
        widget_native_controls_override_aero_caption_buttons_mask_width();
    int overrideCaptionButtonsHeight = StaticPrefs::
        widget_native_controls_override_aero_caption_buttons_mask_height();

    if (!buttonBoxMetrics) {
      RECT captionButtons;
      if (SUCCEEDED(WinUtils::dwmGetWindowAttributePtr(
              aWnd, DWMWA_CAPTION_BUTTON_BOUNDS, &captionButtons,
              sizeof(captionButtons))) &&
          captionButtons.right - captionButtons.left > 3 &&
          captionButtons.bottom - captionButtons.top > 1) {
        buttonBoxMetrics = Some(SIZE{
            captionButtons.right - captionButtons.left - 3,
            captionButtons.bottom - captionButtons.top - 1});
      }
    }

    if (buttonBoxMetrics) {
      sCommandButtonBoxMetrics = *buttonBoxMetrics;

      if (overrideCaptionButtonsWidth > 0) {
        sCommandButtonBoxMetrics.cx = overrideCaptionButtonsWidth;
      }

      if (overrideCaptionButtonsHeight > 0) {
        sCommandButtonBoxMetrics.cy = overrideCaptionButtonsHeight;
      }

      sCommandButtonBoxMetricsInitialized = true;
      // MOZ_ASSERT(
      // sCommandButtonBoxMetrics.cx > 0 && sCommandButtonBoxMetrics.cy > 0,
      // "We must not cache bad command button box dimensions");
      sTitlebarInfoPopulatedAero = true;
    }
  }

  // NB: sTitlebarInfoPopulatedThemed is always true pre-vista.
  if (sTitlebarInfoPopulatedThemed ||
      (IsWin8OrLater() && dwmCompositionEnabled))
    return;

  // Query a temporary, visible window with command buttons to get
  // the right metrics.
  WNDCLASSW wc;
  wc.style = 0;
  wc.lpfnWndProc = ::DefWindowProcW;
  wc.cbClsExtra = 0;
  wc.cbWndExtra = 0;
  wc.hInstance = nsToolkit::mDllInstance;
  wc.hIcon = nullptr;
  wc.hCursor = nullptr;
  wc.hbrBackground = nullptr;
  wc.lpszMenuName = nullptr;
  wc.lpszClassName = kClassNameTemp;
  ::RegisterClassW(&wc);

  // Create a transparent descendant of the window passed in. This
  // keeps the window from showing up on the desktop or the taskbar.
  // Note the parent (browser) window is usually still hidden, we
  // don't want to display it, so we can't query it directly.
  HWND hWnd = CreateWindowExW(WS_EX_LAYERED, kClassNameTemp, L"",
                              WS_OVERLAPPEDWINDOW, 0, 0, 0, 0, aWnd, nullptr,
                              nsToolkit::mDllInstance, nullptr);
  NS_ASSERTION(hWnd, "UpdateTitlebarInfo window creation failed.");

  int showType = SW_SHOWNA;
  // We try to avoid activating this window, but on Aero basic (aero without
  // compositor) and aero lite (special theme for win server 2012/2013) we may
  // get the wrong information if the window isn't activated, so we have to:
  if (!dwmCompositionEnabled) {
    showType = SW_SHOW;
  }
  ShowWindow(hWnd, showType);
  TITLEBARINFOEX info = {0};
  info.cbSize = sizeof(TITLEBARINFOEX);
  SendMessage(hWnd, WM_GETTITLEBARINFOEX, 0, (LPARAM)&info);
  DestroyWindow(hWnd);

  // Only set if we have valid data for all three buttons we use.
  if ((info.rgrect[2].right - info.rgrect[2].left) == 0 ||
      (info.rgrect[3].right - info.rgrect[3].left) == 0 ||
      (info.rgrect[5].right - info.rgrect[5].left) == 0) {
    NS_WARNING("WM_GETTITLEBARINFOEX query failed to find usable metrics.");
    return;
  }
  // minimize
  sCommandButtonMetrics[0].cx = info.rgrect[2].right - info.rgrect[2].left;
  sCommandButtonMetrics[0].cy = info.rgrect[2].bottom - info.rgrect[2].top;
  // maximize/restore
  sCommandButtonMetrics[1].cx = info.rgrect[3].right - info.rgrect[3].left;
  sCommandButtonMetrics[1].cy = info.rgrect[3].bottom - info.rgrect[3].top;
  // close
  sCommandButtonMetrics[2].cx = info.rgrect[5].right - info.rgrect[5].left;
  sCommandButtonMetrics[2].cy = info.rgrect[5].bottom - info.rgrect[5].top;
  sCommandButtonMetricsInitialized = true;

#ifdef DEBUG
  // Verify that all values for the command buttons are positive values
  // otherwise we have cached bad values for the caption buttons
  for (int i = 0; i < NUM_COMMAND_BUTTONS; i++) {
    MOZ_ASSERT(sCommandButtonMetrics[i].cx > 0);
    MOZ_ASSERT(sCommandButtonMetrics[i].cy > 0);
  }
#endif

  sTitlebarInfoPopulatedThemed = true;
}

// visual style (aero glass, aero basic)
//    theme (aero, luna, zune)
//      theme color (silver, olive, blue)
//        system colors

const struct {
  LPCWSTR name;
  WindowsTheme type;
} kKnownThemes[] = {{L"aero.msstyles", WindowsTheme::Aero},
                    {L"aerolite.msstyles", WindowsTheme::AeroLite},
                    {L"luna.msstyles", WindowsTheme::Luna},
                    {L"zune.msstyles", WindowsTheme::Zune},
                    {L"royale.msstyles", WindowsTheme::Royale}};

bool nsUXThemeData::sIsDefaultWindowsTheme = false;
bool nsUXThemeData::sIsHighContrastOn = false;

// static
bool nsUXThemeData::IsDefaultWindowTheme() { return sIsDefaultWindowsTheme; }

bool nsUXThemeData::IsHighContrastOn() { return sIsHighContrastOn; }

// static
void nsUXThemeData::UpdateNativeThemeInfo() {
  // Trigger a refresh of caption button metrics if needed.
  sTitlebarInfoPopulatedAero = sTitlebarInfoPopulatedThemed = !IsVistaOrLater();
  sNativeAeroButtonSize.reset();

  sIsDefaultWindowsTheme = false;
  sThemeId = WindowsTheme::Generic;

  HIGHCONTRAST highContrastInfo;
  highContrastInfo.cbSize = sizeof(HIGHCONTRAST);
  if (SystemParametersInfo(SPI_GETHIGHCONTRAST, 0, &highContrastInfo, 0)) {
    sIsHighContrastOn = ((highContrastInfo.dwFlags & HCF_HIGHCONTRASTON) != 0);
  } else {
    sIsHighContrastOn = false;
  }

  if (!nsUXThemeData::IsAppThemed()) {
    sThemeId = WindowsTheme::Classic;
    return;
  }

  WCHAR themeFileName[MAX_PATH + 1];
  WCHAR themeColor[MAX_PATH + 1];
  if (FAILED(GetCurrentThemeName(themeFileName, MAX_PATH, themeColor, MAX_PATH,
                                 nullptr, 0))) {
    sThemeId = WindowsTheme::Classic;
    return;
  }

  LPCWSTR themeName = wcsrchr(themeFileName, L'\\');
  themeName = themeName ? themeName + 1 : themeFileName;

  sThemeId = [&] {
    for (const auto& theme : kKnownThemes) {
      if (!lstrcmpiW(themeName, theme.name)) {
        return theme.type;
      }
    }
    return WindowsTheme::Generic;
  }();

  // We're using the default theme if we're using any of Aero, Aero Lite, or
  // luna. However, on Win8, GetCurrentThemeName (see above) returns
  // AeroLite.msstyles for the 4 builtin highcontrast themes as well. Those
  // themes "don't count" as default themes, so we specifically check for high
  // contrast mode in that situation.
  sIsDefaultWindowsTheme = [&] {
    if (sIsHighContrastOn && IsWin8OrLater()) {
      return false;
    }
    return sThemeId == WindowsTheme::Aero ||
           sThemeId == WindowsTheme::AeroLite || sThemeId == WindowsTheme::Luna;
  }();
}

// static
bool nsUXThemeData::AreFlatMenusEnabled() {
  BOOL useFlat = FALSE;
  return !!::SystemParametersInfo(SPI_GETFLATMENU, 0, &useFlat, 0) ? useFlat
                                                                   : false;
}

// static
bool nsUXThemeData::IsAppThemed() { return !!::IsAppThemed(); }
