/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_widget_WinThemeSurface_h
#define mozilla_widget_WinThemeSurface_h

#include "mozilla/ipc/SharedMemoryHandle.h"
#include "nsTArray.h"

namespace mozilla::widget {

bool ShouldUseWindowsNativeThemeAtlas();
bool BuildWindowsNativeThemeAtlas(nsTArray<uint8_t>& aData);
void SetWindowsNativeThemeAtlas(
    mozilla::ipc::ReadOnlySharedMemoryHandle&& aHandle);
bool HasWindowsNativeThemeAtlas();

}  // namespace mozilla::widget

#endif  // mozilla_widget_WinThemeSurface_h
