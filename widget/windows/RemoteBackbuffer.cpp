/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "RemoteBackbuffer.h"
#include "GeckoProfiler.h"
#include "nsThreadUtils.h"
#include "mozilla/Span.h"
#include "mozilla/gfx/Point.h"
#include "mozilla/gfx/Logging.h"
#include "mozilla/layers/HelpersD3D11.h"
#include "mozilla/RefPtr.h"
#include "nsWindowsHelpers.h"
#include "WinUtils.h"
#include <algorithm>
#include <type_traits>
#include <dxgi.h>

namespace mozilla {
namespace widget {
namespace remote_backbuffer {

// This number can be adjusted as a time-memory tradeoff
constexpr uint8_t kMaxDirtyRects = 8;

struct IpcSafeRect {
  explicit IpcSafeRect(const gfx::IntRect& aRect)
      : x(aRect.x), y(aRect.y), width(aRect.width), height(aRect.height) {}
  int32_t x;
  int32_t y;
  int32_t width;
  int32_t height;
};

enum class ResponseResult {
  Unknown,
  Error,
  BorrowSuccess,
  BorrowSameBuffer,
  PresentSuccess,
  D3D11Success
};

enum class SharedDataType : uint32_t {
  BorrowRequest,
  BorrowRequestAllowSameBuffer,
  BorrowResponse,
  PresentRequest,
  PresentResponse,
  D3D11InitializeRequest,
  D3D11InitializeResponse,
  D3D11PresentRequest,
  D3D11PresentResponse,
  D3D11ReleaseRequest,
  D3D11ReleaseResponse
};

struct BorrowResponseData {
  ResponseResult result;
  int32_t width;
  int32_t height;
  HANDLE fileMapping;
};

struct PresentRequestData {
  uint8_t lenDirtyRects;
  IpcSafeRect dirtyRects[kMaxDirtyRects];
};

struct PresentResponseData {
  ResponseResult result;
};
struct D3D11InitializeRequestData {
  HANDLE sharedHandle;
  LUID adapterLuid;
  uint32_t width;
  uint32_t height;
  uint32_t format;
};

struct D3D11ResponseData {
  ResponseResult result;
};

struct SharedData {
  SharedDataType dataType;
  union {
    BorrowResponseData borrowResponse;
    PresentRequestData presentRequest;
    PresentResponseData presentResponse;
    D3D11InitializeRequestData d3d11InitializeRequest;
    D3D11ResponseData d3d11Response;
  } data;
};

static_assert(std::is_trivially_copyable<SharedData>::value &&
                  std::is_standard_layout<SharedData>::value,
              "SharedData must be safe to pass over IPC boundaries");

class SharedImage {
 public:
  SharedImage()
      : mWidth(0), mHeight(0), mFileMapping(nullptr), mPixelData(nullptr) {}

  ~SharedImage() {
    if (mPixelData) {
      MOZ_ALWAYS_TRUE(::UnmapViewOfFile(mPixelData));
    }

    if (mFileMapping) {
      MOZ_ALWAYS_TRUE(::CloseHandle(mFileMapping));
    }
  }

  bool Initialize(int32_t aWidth, int32_t aHeight) {
    MOZ_ASSERT(aWidth);
    MOZ_ASSERT(aHeight);
    MOZ_ASSERT(aWidth > 0);
    MOZ_ASSERT(aHeight > 0);

    mWidth = aWidth;
    mHeight = aHeight;

    DWORD bufferSize = static_cast<DWORD>(mHeight * GetStride());

    mFileMapping = ::CreateFileMappingW(
        INVALID_HANDLE_VALUE, nullptr /*secattr*/, PAGE_READWRITE,
        0 /*sizeHigh*/, bufferSize, nullptr /*name*/);
    if (!mFileMapping) {
      return false;
    }

    void* mappedFilePtr =
        ::MapViewOfFile(mFileMapping, FILE_MAP_ALL_ACCESS, 0 /*offsetHigh*/,
                        0 /*offsetLow*/, 0 /*bytesToMap*/);
    if (!mappedFilePtr) {
      return false;
    }

    mPixelData = reinterpret_cast<unsigned char*>(mappedFilePtr);

    return true;
  }

  bool InitializeRemote(int32_t aWidth, int32_t aHeight, HANDLE aFileMapping) {
    MOZ_ASSERT(aWidth > 0);
    MOZ_ASSERT(aHeight > 0);
    MOZ_ASSERT(aFileMapping);

    mWidth = aWidth;
    mHeight = aHeight;
    mFileMapping = aFileMapping;

    void* mappedFilePtr =
        ::MapViewOfFile(mFileMapping, FILE_MAP_ALL_ACCESS, 0 /*offsetHigh*/,
                        0 /*offsetLow*/, 0 /*bytesToMap*/);
    if (!mappedFilePtr) {
      return false;
    }

    mPixelData = reinterpret_cast<unsigned char*>(mappedFilePtr);

    return true;
  }

  HBITMAP CreateDIBSection() {
    BITMAPINFO bitmapInfo = {};
    bitmapInfo.bmiHeader.biSize = sizeof(bitmapInfo.bmiHeader);
    bitmapInfo.bmiHeader.biWidth = mWidth;
    bitmapInfo.bmiHeader.biHeight = -mHeight;
    bitmapInfo.bmiHeader.biPlanes = 1;
    bitmapInfo.bmiHeader.biBitCount = 32;
    bitmapInfo.bmiHeader.biCompression = BI_RGB;
    void* dummy = nullptr;
    return ::CreateDIBSection(nullptr /*paletteDC*/, &bitmapInfo,
                              DIB_RGB_COLORS, &dummy, mFileMapping,
                              0 /*offset*/);
  }

  HANDLE CreateRemoteFileMapping(HANDLE aTargetProcess) {
    MOZ_ASSERT(aTargetProcess);

    HANDLE fileMapping = nullptr;
    if (!::DuplicateHandle(GetCurrentProcess(), mFileMapping, aTargetProcess,
                           &fileMapping, 0 /*desiredAccess*/,
                           FALSE /*inheritHandle*/, DUPLICATE_SAME_ACCESS)) {
      return nullptr;
    }
    return fileMapping;
  }

  already_AddRefed<gfx::DrawTarget> CreateDrawTarget() {
    return gfx::Factory::CreateDrawTargetForData(
        gfx::BackendType::CAIRO, mPixelData, gfx::IntSize(mWidth, mHeight),
        GetStride(), gfx::SurfaceFormat::B8G8R8A8);
  }

  void CopyPixelsFrom(const SharedImage& other) {
    const unsigned char* src = other.mPixelData;
    unsigned char* dst = mPixelData;

    int32_t width = std::min(mWidth, other.mWidth);
    int32_t height = std::min(mHeight, other.mHeight);

    for (int32_t row = 0; row < height; ++row) {
      memcpy(dst, src, static_cast<uint32_t>(width * kBytesPerPixel));
      src += other.GetStride();
      dst += GetStride();
    }
  }

  int32_t GetWidth() const { return mWidth; }

  int32_t GetHeight() const { return mHeight; }

  SharedImage(const SharedImage&) = delete;
  SharedImage(SharedImage&&) = delete;
  SharedImage& operator=(const SharedImage&) = delete;
  SharedImage& operator=(SharedImage&&) = delete;

 private:
  static constexpr int32_t kBytesPerPixel = 4;

  int32_t GetStride() const {
    // DIB requires 32-bit row alignment
    return (((mWidth * kBytesPerPixel) + 3) / 4) * 4;
  }

  int32_t mWidth;
  int32_t mHeight;
  HANDLE mFileMapping;
  unsigned char* mPixelData;
};

class PresentableSharedImage {
 public:
  PresentableSharedImage()
      : mSharedImage(),
        mDeviceContext(nullptr),
        mDIBSection(nullptr),
        mSavedObject(nullptr) {}

  ~PresentableSharedImage() {
    if (mSavedObject) {
      MOZ_ALWAYS_TRUE(::SelectObject(mDeviceContext, mSavedObject));
    }

    if (mDIBSection) {
      MOZ_ALWAYS_TRUE(::DeleteObject(mDIBSection));
    }

    if (mDeviceContext) {
      MOZ_ALWAYS_TRUE(::DeleteDC(mDeviceContext));
    }
  }

  bool Initialize(int32_t aWidth, int32_t aHeight) {
    if (!mSharedImage.Initialize(aWidth, aHeight)) {
      return false;
    }

    mDeviceContext = ::CreateCompatibleDC(nullptr);
    if (!mDeviceContext) {
      return false;
    }

    mDIBSection = mSharedImage.CreateDIBSection();
    if (!mDIBSection) {
      return false;
    }

    mSavedObject = ::SelectObject(mDeviceContext, mDIBSection);
    if (!mSavedObject) {
      return false;
    }

    return true;
  }

  bool PresentToWindow(HWND aWindowHandle, TransparencyMode aTransparencyMode,
                       Span<const IpcSafeRect> aDirtyRects) {
    if (aTransparencyMode == TransparencyMode::Transparent) {
      // If our window is a child window or a child-of-a-child, the window
      // that needs to be updated is the top level ancestor of the tree
      HWND topLevelWindow = WinUtils::GetTopLevelHWND(aWindowHandle, true);
      MOZ_ASSERT(::GetWindowLongPtr(topLevelWindow, GWL_EXSTYLE) &
                 WS_EX_LAYERED);

      BLENDFUNCTION bf = {AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
      POINT srcPos = {0, 0};
      RECT clientRect = {};
      if (!::GetClientRect(aWindowHandle, &clientRect)) {
        return false;
      }
      MOZ_ASSERT(clientRect.left == 0);
      MOZ_ASSERT(clientRect.top == 0);
      int32_t width = clientRect.right;
      int32_t height = clientRect.bottom;
      SIZE winSize = {width, height};
      // Window resize could cause the client area to be different than
      // mSharedImage's size. If the client area doesn't match,
      // PresentToWindow() returns false without calling UpdateLayeredWindow().
      // Another call to UpdateLayeredWindow() will follow shortly, since the
      // resize will eventually force the backbuffer to repaint itself again.
      // When client area is larger than mSharedImage's size,
      // UpdateLayeredWindow() draws the window completely invisible. But it
      // does not return false.
      if (width != mSharedImage.GetWidth() ||
          height != mSharedImage.GetHeight()) {
        return false;
      }

      return !!::UpdateLayeredWindow(
          topLevelWindow, nullptr /*paletteDC*/, nullptr /*newPos*/, &winSize,
          mDeviceContext, &srcPos, 0 /*colorKey*/, &bf, ULW_ALPHA);
    }

    gfx::IntRect sharedImageRect{0, 0, mSharedImage.GetWidth(),
                                 mSharedImage.GetHeight()};

    bool result = true;

    HDC windowDC = ::GetDC(aWindowHandle);
    if (!windowDC) {
      return false;
    }

    for (auto& ipcDirtyRect : aDirtyRects) {
      gfx::IntRect dirtyRect{ipcDirtyRect.x, ipcDirtyRect.y, ipcDirtyRect.width,
                             ipcDirtyRect.height};
      gfx::IntRect bltRect = dirtyRect.Intersect(sharedImageRect);

      if (!::BitBlt(windowDC, bltRect.x /*dstX*/, bltRect.y /*dstY*/,
                    bltRect.width, bltRect.height, mDeviceContext,
                    bltRect.x /*srcX*/, bltRect.y /*srcY*/, SRCCOPY)) {
        result = false;
        break;
      }
    }

    MOZ_ALWAYS_TRUE(::ReleaseDC(aWindowHandle, windowDC));

    return result;
  }

  HANDLE CreateRemoteFileMapping(HANDLE aTargetProcess) {
    return mSharedImage.CreateRemoteFileMapping(aTargetProcess);
  }

  already_AddRefed<gfx::DrawTarget> CreateDrawTarget() {
    return mSharedImage.CreateDrawTarget();
  }

  void CopyPixelsFrom(const PresentableSharedImage& other) {
    mSharedImage.CopyPixelsFrom(other.mSharedImage);
  }

  int32_t GetWidth() { return mSharedImage.GetWidth(); }

  int32_t GetHeight() { return mSharedImage.GetHeight(); }

  PresentableSharedImage(const PresentableSharedImage&) = delete;
  PresentableSharedImage(PresentableSharedImage&&) = delete;
  PresentableSharedImage& operator=(const PresentableSharedImage&) = delete;
  PresentableSharedImage& operator=(PresentableSharedImage&&) = delete;

 private:
  SharedImage mSharedImage;
  HDC mDeviceContext;
  HBITMAP mDIBSection;
  HGDIOBJ mSavedObject;
};
class D3D11Presenter {
 public:
  explicit D3D11Presenter(HWND aWindowHandle)
      : mWindowHandle(aWindowHandle), mAdapterLuid{}, mHasAdapter(false) {}

  bool Initialize(const D3D11InitializeRequestData& aRequest) {
    mSourceTexture = nullptr;

    if (!aRequest.sharedHandle || !aRequest.width || !aRequest.height ||
        aRequest.format != DXGI_FORMAT_B8G8R8A8_UNORM) {
      gfxCriticalNote
          << "Remote D3D11 presenter received invalid texture metadata";
      return false;
    }

    if (!mDevice || !mHasAdapter ||
        mAdapterLuid.HighPart != aRequest.adapterLuid.HighPart ||
        mAdapterLuid.LowPart != aRequest.adapterLuid.LowPart) {
      if (!CreateDevice(aRequest.adapterLuid)) {
        return false;
      }
    }

    RefPtr<ID3D11Resource> resource;
    HRESULT hr = mDevice->OpenSharedResource(aRequest.sharedHandle,
                                             __uuidof(ID3D11Resource),
                                             (void**)getter_AddRefs(resource));
    if (FAILED(hr)) {
      gfxCriticalNote << "Remote D3D11 OpenSharedResource failed: "
                      << gfx::hexa(hr);
      return false;
    }

    RefPtr<ID3D11Texture2D> sourceTexture;
    hr = resource->QueryInterface(__uuidof(ID3D11Texture2D),
                                  (void**)getter_AddRefs(sourceTexture));
    if (FAILED(hr)) {
      gfxCriticalNote << "Remote D3D11 shared resource is not a texture: "
                      << gfx::hexa(hr);
      return false;
    }

    D3D11_TEXTURE2D_DESC sourceDesc{};
    sourceTexture->GetDesc(&sourceDesc);
    if (sourceDesc.Width != aRequest.width ||
        sourceDesc.Height != aRequest.height ||
        sourceDesc.Format != DXGI_FORMAT_B8G8R8A8_UNORM ||
        sourceDesc.MipLevels != 1 || sourceDesc.ArraySize != 1 ||
        sourceDesc.SampleDesc.Count != 1 ||
        sourceDesc.Usage != D3D11_USAGE_DEFAULT) {
      gfxCriticalNote
          << "Remote D3D11 shared texture has incompatible descriptor";
      return false;
    }

    if (!CreateOrResizeSwapChain(aRequest.width, aRequest.height)) {
      return false;
    }

    RefPtr<ID3D11Texture2D> backbuffer;
    hr = mSwapChain->GetBuffer(0, __uuidof(ID3D11Texture2D),
                               (void**)getter_AddRefs(backbuffer));
    if (FAILED(hr)) {
      gfxCriticalNote << "Remote D3D11 swap chain GetBuffer failed: "
                      << gfx::hexa(hr);
      return false;
    }

    mSourceTexture = std::move(sourceTexture);
    mBackbuffer = std::move(backbuffer);
    return true;
  }

  bool Present() {
    if (!mSourceTexture || !mBackbuffer || !mCompletionQuery) {
      return false;
    }

    mContext->CopyResource(mBackbuffer, mSourceTexture);
    mContext->End(mCompletionQuery);
    mContext->Flush();
    BOOL complete = FALSE;
    if (!layers::WaitForFrameGPUQuery(mDevice, mContext, mCompletionQuery,
                                      &complete) ||
        !complete) {
      HRESULT hr = mDevice->GetDeviceRemovedReason();
      gfxCriticalNote << "Remote D3D11 copy completion failed: "
                      << gfx::hexa(hr);
      return false;
    }

    HRESULT hr = mSwapChain->Present(0, 0);
    if (FAILED(hr)) {
      gfxCriticalNote << "Remote D3D11 Present failed: " << gfx::hexa(hr);
      return false;
    }
    return true;
  }

  void ReleaseTexture() {
    mSourceTexture = nullptr;
    mBackbuffer = nullptr;
  }

 private:
  bool LoadModules() {
    if (mDXGIModule && mD3D11Module) {
      return true;
    }
    if (!mDXGIModule) {
      mDXGIModule.own(LoadLibrarySystem32(L"dxgi.dll"));
    }
    if (!mD3D11Module) {
      mD3D11Module.own(LoadLibrarySystem32(L"d3d11.dll"));
    }
    if (!mDXGIModule || !mD3D11Module) {
      gfxCriticalNote << "Remote D3D11 failed to load system DLLs: "
                      << ::GetLastError();
      return false;
    }
    return true;
  }

  bool CreateDevice(const LUID& aAdapterLuid) {
    ReleaseTexture();
    mCompletionQuery = nullptr;
    mSwapChain = nullptr;
    mContext = nullptr;
    mDevice = nullptr;
    mFactory = nullptr;
    mHasAdapter = false;

    if (!LoadModules()) {
      return false;
    }

    auto createDXGIFactory = reinterpret_cast<decltype(&CreateDXGIFactory)>(
        ::GetProcAddress(mDXGIModule, "CreateDXGIFactory"));
    auto d3d11CreateDevice = reinterpret_cast<decltype(&D3D11CreateDevice)>(
        ::GetProcAddress(mD3D11Module, "D3D11CreateDevice"));
    if (!createDXGIFactory || !d3d11CreateDevice) {
      gfxCriticalNote << "Remote D3D11 failed to resolve system entry points";
      return false;
    }

    HRESULT hr = createDXGIFactory(__uuidof(IDXGIFactory),
                                   (void**)getter_AddRefs(mFactory));
    if (FAILED(hr)) {
      gfxCriticalNote << "Remote D3D11 CreateDXGIFactory failed: "
                      << gfx::hexa(hr);
      return false;
    }

    RefPtr<IDXGIAdapter> matchingAdapter;
    for (UINT index = 0;; ++index) {
      RefPtr<IDXGIAdapter> adapter;
      hr = mFactory->EnumAdapters(index, getter_AddRefs(adapter));
      if (hr == DXGI_ERROR_NOT_FOUND) {
        break;
      }
      if (FAILED(hr)) {
        gfxCriticalNote << "Remote D3D11 EnumAdapters failed: "
                        << gfx::hexa(hr);
        return false;
      }
      DXGI_ADAPTER_DESC desc{};
      hr = adapter->GetDesc(&desc);
      if (FAILED(hr)) {
        gfxCriticalNote << "Remote D3D11 adapter GetDesc failed: "
                        << gfx::hexa(hr);
        return false;
      }
      if (desc.AdapterLuid.HighPart == aAdapterLuid.HighPart &&
          desc.AdapterLuid.LowPart == aAdapterLuid.LowPart) {
        matchingAdapter = std::move(adapter);
        break;
      }
    }
    if (!matchingAdapter) {
      gfxCriticalNote << "Remote D3D11 could not find the producer adapter";
      return false;
    }

    hr = d3d11CreateDevice(matchingAdapter, D3D_DRIVER_TYPE_UNKNOWN, nullptr,
                           D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0,
                           D3D11_SDK_VERSION, getter_AddRefs(mDevice), nullptr,
                           getter_AddRefs(mContext));
    if (FAILED(hr)) {
      gfxCriticalNote << "Remote D3D11 device creation failed: "
                      << gfx::hexa(hr);
      return false;
    }

    D3D11_QUERY_DESC queryDesc{D3D11_QUERY_EVENT, 0};
    hr = mDevice->CreateQuery(&queryDesc, getter_AddRefs(mCompletionQuery));
    if (FAILED(hr)) {
      gfxCriticalNote << "Remote D3D11 event query creation failed: "
                      << gfx::hexa(hr);
      return false;
    }

    mAdapterLuid = aAdapterLuid;
    mHasAdapter = true;
    return true;
  }

  bool CreateOrResizeSwapChain(uint32_t aWidth, uint32_t aHeight) {
    HRESULT hr;
    if (mSwapChain) {
      mBackbuffer = nullptr;
      hr = mSwapChain->ResizeBuffers(1, aWidth, aHeight,
                                     DXGI_FORMAT_B8G8R8A8_UNORM, 0);
      if (FAILED(hr)) {
        gfxCriticalNote << "Remote D3D11 ResizeBuffers failed: "
                        << gfx::hexa(hr);
        return false;
      }
      return true;
    }

    DXGI_SWAP_CHAIN_DESC desc{};
    desc.BufferDesc.Width = aWidth;
    desc.BufferDesc.Height = aHeight;
    desc.BufferDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.BufferDesc.RefreshRate.Numerator = 60;
    desc.BufferDesc.RefreshRate.Denominator = 1;
    desc.SampleDesc.Count = 1;
    desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    desc.BufferCount = 1;
    desc.OutputWindow = mWindowHandle;
    desc.Windowed = TRUE;
    desc.SwapEffect = DXGI_SWAP_EFFECT_SEQUENTIAL;
    hr = mFactory->MakeWindowAssociation(mWindowHandle,
                                         DXGI_MWA_NO_WINDOW_CHANGES);
    if (FAILED(hr)) {
      gfxCriticalNote << "Remote D3D11 MakeWindowAssociation failed: "
                      << gfx::hexa(hr);
      return false;
    }
    hr = mFactory->CreateSwapChain(mDevice, &desc, getter_AddRefs(mSwapChain));
    if (FAILED(hr)) {
      gfxCriticalNote << "Remote D3D11 CreateSwapChain failed: "
                      << gfx::hexa(hr);
      return false;
    }
    return true;
  }

  HWND mWindowHandle;
  nsModuleHandle mDXGIModule;
  nsModuleHandle mD3D11Module;
  RefPtr<IDXGIFactory> mFactory;
  RefPtr<ID3D11Device> mDevice;
  RefPtr<ID3D11DeviceContext> mContext;
  RefPtr<IDXGISwapChain> mSwapChain;
  RefPtr<ID3D11Texture2D> mSourceTexture;
  RefPtr<ID3D11Texture2D> mBackbuffer;
  RefPtr<ID3D11Query> mCompletionQuery;
  LUID mAdapterLuid;
  bool mHasAdapter;
};

Provider::Provider()
    : mWindowHandle(nullptr),
      mTargetProcess(nullptr),
      mFileMapping(nullptr),
      mRequestReadyEvent(nullptr),
      mResponseReadyEvent(nullptr),
      mSharedDataPtr(nullptr),
      mStopServiceThread(false),
      mServiceThread(nullptr),
      mBackbuffer(),
      mD3D11Presenter() {}

Provider::~Provider() {
  if (mServiceThread) {
    mStopServiceThread = true;
    MOZ_ALWAYS_TRUE(::SetEvent(mRequestReadyEvent));
    MOZ_ALWAYS_TRUE(PR_JoinThread(mServiceThread) == PR_SUCCESS);
  }

  if (mSharedDataPtr) {
    MOZ_ALWAYS_TRUE(::UnmapViewOfFile(mSharedDataPtr));
  }

  if (mResponseReadyEvent) {
    MOZ_ALWAYS_TRUE(::CloseHandle(mResponseReadyEvent));
  }

  if (mRequestReadyEvent) {
    MOZ_ALWAYS_TRUE(::CloseHandle(mRequestReadyEvent));
  }

  if (mFileMapping) {
    MOZ_ALWAYS_TRUE(::CloseHandle(mFileMapping));
  }

  if (mTargetProcess) {
    MOZ_ALWAYS_TRUE(::CloseHandle(mTargetProcess));
  }
}

bool Provider::Initialize(HWND aWindowHandle, DWORD aTargetProcessId,
                          TransparencyMode aTransparencyMode) {
  MOZ_ASSERT(aWindowHandle);
  MOZ_ASSERT(aTargetProcessId);

  mWindowHandle = aWindowHandle;

  mTargetProcess = ::OpenProcess(PROCESS_DUP_HANDLE, FALSE /*inheritHandle*/,
                                 aTargetProcessId);
  if (!mTargetProcess) {
    return false;
  }

  mFileMapping = ::CreateFileMappingW(
      INVALID_HANDLE_VALUE, nullptr /*secattr*/, PAGE_READWRITE, 0 /*sizeHigh*/,
      static_cast<DWORD>(sizeof(SharedData)), nullptr /*name*/);
  if (!mFileMapping) {
    return false;
  }

  mRequestReadyEvent =
      ::CreateEventW(nullptr /*secattr*/, FALSE /*manualReset*/,
                     FALSE /*initialState*/, nullptr /*name*/);
  if (!mRequestReadyEvent) {
    return false;
  }

  mResponseReadyEvent =
      ::CreateEventW(nullptr /*secattr*/, FALSE /*manualReset*/,
                     FALSE /*initialState*/, nullptr /*name*/);
  if (!mResponseReadyEvent) {
    return false;
  }

  void* mappedFilePtr =
      ::MapViewOfFile(mFileMapping, FILE_MAP_ALL_ACCESS, 0 /*offsetHigh*/,
                      0 /*offsetLow*/, 0 /*bytesToMap*/);
  if (!mappedFilePtr) {
    return false;
  }

  mSharedDataPtr = reinterpret_cast<SharedData*>(mappedFilePtr);

  mStopServiceThread = false;

  // Use a raw NSPR OS-level thread here instead of nsThread because we are
  // performing low-level synchronization across processes using Win32 Events,
  // and nsThread is designed around an incompatible "in-process task queue"
  // model
  mServiceThread = PR_CreateThread(
      PR_USER_THREAD, [](void* p) { static_cast<Provider*>(p)->ThreadMain(); },
      this, PR_PRIORITY_NORMAL, PR_GLOBAL_THREAD, PR_JOINABLE_THREAD, 0);
  if (!mServiceThread) {
    return false;
  }

  mTransparencyMode = uint32_t(aTransparencyMode);

  return true;
}

Maybe<RemoteBackbufferHandles> Provider::CreateRemoteHandles() {
  return Some(
      RemoteBackbufferHandles(ipc::FileDescriptor(mFileMapping),
                              ipc::FileDescriptor(mRequestReadyEvent),
                              ipc::FileDescriptor(mResponseReadyEvent)));
}

void Provider::UpdateTransparencyMode(TransparencyMode aTransparencyMode) {
  mTransparencyMode = uint32_t(aTransparencyMode);
}

void Provider::ThreadMain() {
  AUTO_PROFILER_REGISTER_THREAD("RemoteBackbuffer");
  NS_SetCurrentThreadName("RemoteBackbuffer");

  while (true) {
    {
      AUTO_PROFILER_THREAD_SLEEP;
      MOZ_ALWAYS_TRUE(::WaitForSingleObject(mRequestReadyEvent, INFINITE) ==
                      WAIT_OBJECT_0);
    }

    if (mStopServiceThread) {
      break;
    }

    switch (mSharedDataPtr->dataType) {
      case SharedDataType::BorrowRequest:
      case SharedDataType::BorrowRequestAllowSameBuffer: {
        BorrowResponseData responseData = {};

        HandleBorrowRequest(&responseData,
                            mSharedDataPtr->dataType ==
                                SharedDataType::BorrowRequestAllowSameBuffer);

        mSharedDataPtr->dataType = SharedDataType::BorrowResponse;
        mSharedDataPtr->data.borrowResponse = responseData;

        MOZ_ALWAYS_TRUE(::SetEvent(mResponseReadyEvent));

        break;
      }
      case SharedDataType::PresentRequest: {
        PresentRequestData requestData = mSharedDataPtr->data.presentRequest;
        PresentResponseData responseData = {};

        HandlePresentRequest(requestData, &responseData);

        mSharedDataPtr->dataType = SharedDataType::PresentResponse;
        mSharedDataPtr->data.presentResponse = responseData;

        MOZ_ALWAYS_TRUE(::SetEvent(mResponseReadyEvent));

        break;
      }
      case SharedDataType::D3D11InitializeRequest: {
        D3D11InitializeRequestData requestData =
            mSharedDataPtr->data.d3d11InitializeRequest;
        D3D11ResponseData responseData{};
        HandleD3D11InitializeRequest(requestData, &responseData);
        mSharedDataPtr->dataType = SharedDataType::D3D11InitializeResponse;
        mSharedDataPtr->data.d3d11Response = responseData;
        MOZ_ALWAYS_TRUE(::SetEvent(mResponseReadyEvent));
        break;
      }
      case SharedDataType::D3D11PresentRequest: {
        D3D11ResponseData responseData{};
        HandleD3D11PresentRequest(&responseData);
        mSharedDataPtr->dataType = SharedDataType::D3D11PresentResponse;
        mSharedDataPtr->data.d3d11Response = responseData;
        MOZ_ALWAYS_TRUE(::SetEvent(mResponseReadyEvent));
        break;
      }
      case SharedDataType::D3D11ReleaseRequest: {
        mD3D11Presenter.reset();
        mSharedDataPtr->dataType = SharedDataType::D3D11ReleaseResponse;
        mSharedDataPtr->data.d3d11Response.result =
            ResponseResult::D3D11Success;
        MOZ_ALWAYS_TRUE(::SetEvent(mResponseReadyEvent));
        break;
      }
      default:
        break;
    };
  }

  mD3D11Presenter.reset();
  mBackbuffer.reset();
}

void Provider::HandleBorrowRequest(BorrowResponseData* aResponseData,
                                   bool aAllowSameBuffer) {
  MOZ_ASSERT(aResponseData);

  aResponseData->result = ResponseResult::Error;

  RECT clientRect{};
  if (!::GetClientRect(mWindowHandle, &clientRect)) {
    return;
  }

  MOZ_ASSERT(clientRect.left == 0);
  MOZ_ASSERT(clientRect.top == 0);

  const int32_t width = std::max(int32_t(clientRect.right), 1);
  const int32_t height = std::max(int32_t(clientRect.bottom), 1);

  bool needNewBackbuffer = !aAllowSameBuffer || !mBackbuffer ||
                           mBackbuffer->GetWidth() != width ||
                           mBackbuffer->GetHeight() != height;

  if (!needNewBackbuffer) {
    aResponseData->result = ResponseResult::BorrowSameBuffer;
    return;
  }

  auto newBackbuffer = std::make_unique<PresentableSharedImage>();
  if (!newBackbuffer->Initialize(width, height)) {
    return;
  }

  // Preserve the contents of the old backbuffer (if it exists)
  if (mBackbuffer) {
    newBackbuffer->CopyPixelsFrom(*mBackbuffer);
    mBackbuffer.reset();
  }

  HANDLE remoteFileMapping =
      newBackbuffer->CreateRemoteFileMapping(mTargetProcess);
  if (!remoteFileMapping) {
    return;
  }

  aResponseData->result = ResponseResult::BorrowSuccess;
  aResponseData->width = width;
  aResponseData->height = height;
  aResponseData->fileMapping = remoteFileMapping;

  mBackbuffer = std::move(newBackbuffer);
}

void Provider::HandlePresentRequest(const PresentRequestData& aRequestData,
                                    PresentResponseData* aResponseData) {
  MOZ_ASSERT(aResponseData);

  Span rectSpan(aRequestData.dirtyRects, kMaxDirtyRects);

  aResponseData->result = ResponseResult::Error;

  if (!mBackbuffer) {
    return;
  }

  if (!mBackbuffer->PresentToWindow(
          mWindowHandle, GetTransparencyMode(),
          rectSpan.First(aRequestData.lenDirtyRects))) {
    return;
  }

  aResponseData->result = ResponseResult::PresentSuccess;
}

void Provider::HandleD3D11InitializeRequest(
    const D3D11InitializeRequestData& aRequestData,
    D3D11ResponseData* aResponseData) {
  aResponseData->result = ResponseResult::Error;
  if (!mD3D11Presenter) {
    mD3D11Presenter = std::make_unique<D3D11Presenter>(mWindowHandle);
  }
  if (mD3D11Presenter->Initialize(aRequestData)) {
    aResponseData->result = ResponseResult::D3D11Success;
  }
}

void Provider::HandleD3D11PresentRequest(D3D11ResponseData* aResponseData) {
  aResponseData->result = ResponseResult::Error;
  if (mD3D11Presenter && mD3D11Presenter->Present()) {
    aResponseData->result = ResponseResult::D3D11Success;
  }
}

Client::Client()
    : mRequestMutex("remote_backbuffer::Client::mRequestMutex"),
      mConnectionFailed(false),
      mFileMapping(nullptr),
      mRequestReadyEvent(nullptr),
      mResponseReadyEvent(nullptr),
      mSharedDataPtr(nullptr),
      mBackbuffer() {}

Client::~Client() {
  mBackbuffer.reset();

  if (mSharedDataPtr) {
    MOZ_ALWAYS_TRUE(::UnmapViewOfFile(mSharedDataPtr));
  }

  if (mResponseReadyEvent) {
    MOZ_ALWAYS_TRUE(::CloseHandle(mResponseReadyEvent));
  }

  if (mRequestReadyEvent) {
    MOZ_ALWAYS_TRUE(::CloseHandle(mRequestReadyEvent));
  }

  if (mFileMapping) {
    MOZ_ALWAYS_TRUE(::CloseHandle(mFileMapping));
  }
}

bool Client::Initialize(const RemoteBackbufferHandles& aRemoteHandles) {
  MOZ_ASSERT(aRemoteHandles.fileMapping().IsValid());
  MOZ_ASSERT(aRemoteHandles.requestReadyEvent().IsValid());
  MOZ_ASSERT(aRemoteHandles.responseReadyEvent().IsValid());

  // FIXME: Due to PCompositorWidget using virtual Recv methods,
  // RemoteBackbufferHandles is passed by const reference, and cannot have its
  // signature customized, meaning that we need to clone the handles here.
  //
  // Once PCompositorWidget is migrated to use direct call semantics, the
  // signature can be changed to accept RemoteBackbufferHandles by rvalue
  // reference or value, and the DuplicateHandle calls here can be avoided.
  mFileMapping = aRemoteHandles.fileMapping().ClonePlatformHandle().release();
  mRequestReadyEvent =
      aRemoteHandles.requestReadyEvent().ClonePlatformHandle().release();
  mResponseReadyEvent =
      aRemoteHandles.responseReadyEvent().ClonePlatformHandle().release();

  void* mappedFilePtr =
      ::MapViewOfFile(mFileMapping, FILE_MAP_ALL_ACCESS, 0 /*offsetHigh*/,
                      0 /*offsetLow*/, 0 /*bytesToMap*/);
  if (!mappedFilePtr) {
    return false;
  }

  mSharedDataPtr = reinterpret_cast<SharedData*>(mappedFilePtr);

  return true;
}

already_AddRefed<gfx::DrawTarget> Client::BorrowDrawTarget() {
  MutexAutoLock lock(mRequestMutex);
  if (mConnectionFailed || !mSharedDataPtr) {
    return nullptr;
  }

  mSharedDataPtr->dataType = mBackbuffer
                                 ? SharedDataType::BorrowRequestAllowSameBuffer
                                 : SharedDataType::BorrowRequest;
  if (!SendRequestAndWait(uint32_t(SharedDataType::BorrowResponse))) {
    return nullptr;
  }

  BorrowResponseData responseData = mSharedDataPtr->data.borrowResponse;
  if ((responseData.result != ResponseResult::BorrowSameBuffer) &&
      (responseData.result != ResponseResult::BorrowSuccess)) {
    return nullptr;
  }

  if (responseData.result == ResponseResult::BorrowSuccess) {
    mBackbuffer.reset();
    auto newBackbuffer = std::make_unique<SharedImage>();
    if (!newBackbuffer->InitializeRemote(responseData.width,
                                         responseData.height,
                                         responseData.fileMapping)) {
      return nullptr;
    }
    mBackbuffer = std::move(newBackbuffer);
  }

  MOZ_ASSERT(mBackbuffer);
  return mBackbuffer->CreateDrawTarget();
}

bool Client::PresentDrawTarget(gfx::IntRegion aDirtyRegion) {
  MutexAutoLock lock(mRequestMutex);
  if (mConnectionFailed || !mSharedDataPtr) {
    return false;
  }

  mSharedDataPtr->dataType = SharedDataType::PresentRequest;
  // Simplify the region until it has <= kMaxDirtyRects
  aDirtyRegion.SimplifyOutward(kMaxDirtyRects);
  Span rectSpan(mSharedDataPtr->data.presentRequest.dirtyRects, kMaxDirtyRects);

  uint8_t rectIndex = 0;
  for (auto iter = aDirtyRegion.RectIter(); !iter.Done(); iter.Next()) {
    rectSpan[rectIndex] = IpcSafeRect(iter.Get());
    ++rectIndex;
  }
  mSharedDataPtr->data.presentRequest.lenDirtyRects = rectIndex;

  return SendRequestAndWait(uint32_t(SharedDataType::PresentResponse)) &&
         mSharedDataPtr->data.presentResponse.result ==
             ResponseResult::PresentSuccess;
}

bool Client::InitializeD3D11Texture(ID3D11Texture2D* aTexture) {
  if (!aTexture) {
    return false;
  }

  RefPtr<IDXGIResource> resource;
  HRESULT hr = aTexture->QueryInterface(__uuidof(IDXGIResource),
                                        (void**)getter_AddRefs(resource));
  if (FAILED(hr)) {
    gfxCriticalNote << "Remote D3D11 texture QueryInterface failed: "
                    << gfx::hexa(hr);
    return false;
  }

  HANDLE sharedHandle = nullptr;
  hr = resource->GetSharedHandle(&sharedHandle);
  if (FAILED(hr) || !sharedHandle) {
    gfxCriticalNote << "Remote D3D11 GetSharedHandle failed: " << gfx::hexa(hr);
    return false;
  }

  RefPtr<ID3D11Device> device;
  aTexture->GetDevice(getter_AddRefs(device));
  RefPtr<IDXGIDevice> dxgiDevice;
  hr = device->QueryInterface(__uuidof(IDXGIDevice),
                              (void**)getter_AddRefs(dxgiDevice));
  if (FAILED(hr)) {
    gfxCriticalNote << "Remote D3D11 device QueryInterface failed: "
                    << gfx::hexa(hr);
    return false;
  }
  RefPtr<IDXGIAdapter> adapter;
  hr = dxgiDevice->GetAdapter(getter_AddRefs(adapter));
  if (FAILED(hr)) {
    gfxCriticalNote << "Remote D3D11 GetAdapter failed: " << gfx::hexa(hr);
    return false;
  }
  DXGI_ADAPTER_DESC adapterDesc{};
  hr = adapter->GetDesc(&adapterDesc);
  if (FAILED(hr)) {
    gfxCriticalNote << "Remote D3D11 adapter GetDesc failed: " << gfx::hexa(hr);
    return false;
  }

  D3D11_TEXTURE2D_DESC textureDesc{};
  aTexture->GetDesc(&textureDesc);

  MutexAutoLock lock(mRequestMutex);
  if (mConnectionFailed || !mSharedDataPtr) {
    return false;
  }
  mSharedDataPtr->dataType = SharedDataType::D3D11InitializeRequest;
  auto& request = mSharedDataPtr->data.d3d11InitializeRequest;
  request.sharedHandle = sharedHandle;
  request.adapterLuid = adapterDesc.AdapterLuid;
  request.width = textureDesc.Width;
  request.height = textureDesc.Height;
  request.format = uint32_t(textureDesc.Format);

  return SendRequestAndWait(
             uint32_t(SharedDataType::D3D11InitializeResponse)) &&
         mSharedDataPtr->data.d3d11Response.result ==
             ResponseResult::D3D11Success;
}

bool Client::PresentD3D11Texture() {
  MutexAutoLock lock(mRequestMutex);
  if (mConnectionFailed || !mSharedDataPtr) {
    return false;
  }
  mSharedDataPtr->dataType = SharedDataType::D3D11PresentRequest;
  return SendRequestAndWait(uint32_t(SharedDataType::D3D11PresentResponse)) &&
         mSharedDataPtr->data.d3d11Response.result ==
             ResponseResult::D3D11Success;
}

void Client::ReleaseD3D11Texture() {
  MutexAutoLock lock(mRequestMutex);
  if (mConnectionFailed || !mSharedDataPtr) {
    return;
  }
  mSharedDataPtr->dataType = SharedDataType::D3D11ReleaseRequest;
  (void)SendRequestAndWait(uint32_t(SharedDataType::D3D11ReleaseResponse));
}

bool Client::SendRequestAndWait(uint32_t aExpectedResponseType) {
  MOZ_ASSERT(!mConnectionFailed);
  if (!::SetEvent(mRequestReadyEvent)) {
    gfxCriticalNote << "Remote backbuffer SetEvent failed: "
                    << ::GetLastError();
    mConnectionFailed = true;
    return false;
  }

  constexpr DWORD kResponseTimeoutMs = 5000;
  DWORD waitResult =
      ::WaitForSingleObject(mResponseReadyEvent, kResponseTimeoutMs);
  if (waitResult != WAIT_OBJECT_0) {
    gfxCriticalNote << "Remote backbuffer response wait failed: " << waitResult
                    << ", error: " << ::GetLastError();
    // Never issue another request: a late response could otherwise be
    // consumed as the response to that request.
    mConnectionFailed = true;
    return false;
  }

  if (uint32_t(mSharedDataPtr->dataType) != aExpectedResponseType) {
    gfxCriticalNote << "Remote backbuffer received an unexpected response";
    mConnectionFailed = true;
    return false;
  }
  return true;
}

}  // namespace remote_backbuffer
}  // namespace widget
}  // namespace mozilla
