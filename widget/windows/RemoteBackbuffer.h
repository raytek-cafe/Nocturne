/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef widget_windows_RemoteBackbuffer_h
#define widget_windows_RemoteBackbuffer_h

#include "nsIWidget.h"
#include "mozilla/widget/PCompositorWidgetParent.h"
#include "mozilla/Maybe.h"
#include "mozilla/gfx/2D.h"
#include "prthread.h"
#include "mozilla/Mutex.h"
#include <windows.h>

struct ID3D11Texture2D;

namespace mozilla {
namespace widget {
namespace remote_backbuffer {

struct IpcRect;
struct SharedData;
struct BorrowResponseData;
struct PresentRequestData;
struct PresentResponseData;
class SharedImage;
struct D3D11InitializeRequestData;
struct D3D11ResponseData;
class D3D11Presenter;
class PresentableSharedImage;

class Provider {
 public:
  Provider();
  ~Provider();

  bool Initialize(HWND aWindowHandle, DWORD aTargetProcessId,
                  TransparencyMode aTransparencyMode);

  Maybe<RemoteBackbufferHandles> CreateRemoteHandles();

  void UpdateTransparencyMode(TransparencyMode aTransparencyMode);

  Provider(const Provider&) = delete;
  Provider(Provider&&) = delete;
  Provider& operator=(const Provider&) = delete;
  Provider& operator=(Provider&&) = delete;

 private:
  void ThreadMain();

  void HandleBorrowRequest(BorrowResponseData* aResponseData,
                           bool aAllowSameBuffer);
  void HandlePresentRequest(const PresentRequestData& aRequestData,
                            PresentResponseData* aResponseData);
  void HandleD3D11InitializeRequest(
      const D3D11InitializeRequestData& aRequestData,
      D3D11ResponseData* aResponseData);
  void HandleD3D11PresentRequest(D3D11ResponseData* aResponseData);

  HWND mWindowHandle;
  HANDLE mTargetProcess;
  HANDLE mFileMapping;
  HANDLE mRequestReadyEvent;
  HANDLE mResponseReadyEvent;
  SharedData* mSharedDataPtr;
  bool mStopServiceThread;
  PRThread* mServiceThread;
  std::unique_ptr<PresentableSharedImage> mBackbuffer;
  std::unique_ptr<D3D11Presenter> mD3D11Presenter;
  mozilla::Atomic<uint32_t, MemoryOrdering::Relaxed> mTransparencyMode;
  TransparencyMode GetTransparencyMode() const {
    return TransparencyMode(uint32_t(mTransparencyMode));
  }
};

class Client {
 public:
  Client();
  ~Client();

  bool Initialize(const RemoteBackbufferHandles& aRemoteHandles);

  already_AddRefed<gfx::DrawTarget> BorrowDrawTarget();
  bool PresentDrawTarget(gfx::IntRegion aDirtyRegion);
  bool InitializeD3D11Texture(ID3D11Texture2D* aTexture);
  bool PresentD3D11Texture();
  void ReleaseD3D11Texture();

  Client(const Client&) = delete;
  Client(Client&&) = delete;
  Client& operator=(const Client&) = delete;
  Client& operator=(Client&&) = delete;

 private:
  bool SendRequestAndWait(uint32_t aExpectedResponseType);

  Mutex mRequestMutex;
  bool mConnectionFailed;
  HANDLE mFileMapping;
  HANDLE mRequestReadyEvent;
  HANDLE mResponseReadyEvent;
  SharedData* mSharedDataPtr;
  std::unique_ptr<SharedImage> mBackbuffer;
};

}  // namespace remote_backbuffer
}  // namespace widget
}  // namespace mozilla

#endif  // widget_windows_RemoteBackbuffer_h
