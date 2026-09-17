/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef DXVAVP9Manager_h_
#define DXVAVP9Manager_h_

#include "ImageContainer.h"
#include "MediaInfo.h"
#include "VP9DXVA.h"
#include "VP9HeaderParser.h"
#include "WMF.h"
#include "mozilla/Mutex.h"
#include "mozilla/RefPtr.h"
#include "nsPrintfCString.h"
#include "nsTArray.h"

namespace mozilla {

namespace layers {
class KnowsCompositor;
class Image;
class D3D9RecycleAllocator;
}  // namespace layers

class DXVAVP9Manager {
 public:
  DXVAVP9Manager();
  ~DXVAVP9Manager();

  bool Init(IUnknown* aDeviceManager, uint32_t aWidth, uint32_t aHeight,
            nsACString& aFailureReason);
  HRESULT DecodeFrame(const uint8_t* aData, uint32_t aSize,
                      IDirect3DSurface9** aOutSurface, bool* aOutShouldDisplay,
                      VP9FrameHeader* aOutHeader);

  HRESULT ConfigureForSize(uint32_t aWidth, uint32_t aHeight);

  void Flush();
  void Shutdown();

  bool IsValid() const { return mDecoder != nullptr; }

  static const GUID& GetVP9DecoderGUID();

  static bool SupportsVP9(IDirect3DDeviceManager9* aDeviceManager);

 private:
  HRESULT InitDecoder(uint32_t aWidth, uint32_t aHeight);
  HRESULT AllocateSurfaces(uint32_t aWidth, uint32_t aHeight, uint32_t aCount);
  void FreeSurfaces();

  uint32_t PickNextSurface() const;

  void FillPicParams(const VP9FrameHeader& aHeader,
                     UXP_DXVA_PicParams_VP9& aPicParams);

  RefPtr<IDirect3DDeviceManager9> mDeviceManager;
  RefPtr<IDirectXVideoDecoderService> mDecoderService;
  RefPtr<IDirectXVideoDecoder> mDecoder;

  static const uint32_t kMinSurfaces = 9;
  static const uint32_t kDefaultSurfaces = 10;
  static const uint32_t kMaxSurfaces = 24;
  RefPtr<IDirect3DSurface9> mSurfaces[kMaxSurfaces];
  uint32_t mNumSurfaces;
  uint32_t mCurrentSurface;

  uint32_t mWidth;
  uint32_t mHeight;
  uint8_t mRefFrameSurface[8];
  uint32_t mRefFrameWidth[8];
  uint32_t mRefFrameHeight[8];
  uint32_t mFrameCount;

  VP9HeaderParser mParser;
  Mutex mLock;
};
}  // namespace mozilla
#endif
