/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "WMFVP9DXVA2Manager.h"

#include "ImageContainer.h"
#include "VideoUtils.h"
#include "mozilla/CheckedInt.h"
#include "mozilla/WindowsVersion.h"
#include "mozilla/gfx/gfxVars.h"
#include "nsPrintfCString.h"
#include "nsXULAppAPI.h"

namespace mozilla {

using media::TimeUnit;

WMFVP9DXVA2Manager::WMFVP9DXVA2Manager(
    const VideoInfo& aConfig, layers::KnowsCompositor* aKnowsCompositor,
    layers::ImageContainer* aImageContainer)
    : mVideoInfo(aConfig),
      mKnowsCompositor(aKnowsCompositor),
      mImageContainer(aImageContainer) {}

WMFVP9DXVA2Manager::~WMFVP9DXVA2Manager() { Shutdown(); }

MediaResult WMFVP9DXVA2Manager::Init() {
  if (!IsVistaOrLater()) {
    mFailureReason.AssignLiteral("VP9 DXVA2 requires Windows Vista or later");
  } else if (!gfx::gfxVars::CanUseHardwareVideoDecoding()) {
    mFailureReason.AssignLiteral(
        "Hardware video decoding is disabled or blocklisted");
  } else if (!mKnowsCompositor || !mKnowsCompositor->SupportsD3D11()) {
    mFailureReason.AssignLiteral("Unsupported layers backend");
  } else if (!XRE_IsRDDProcess() && !XRE_IsGPUProcess()) {
    mFailureReason.AssignLiteral(
        "VP9 DXVA2 is only supported in the RDD or GPU process");
  } else if (mVideoInfo.HasAlpha()) {
    mFailureReason.AssignLiteral("VP9 DXVA2 cannot decode streams with alpha");
  } else if (mVideoInfo.mColorDepth != gfx::ColorDepth::COLOR_8) {
    mFailureReason =
        nsPrintfCString("VP9 DXVA2 supports profile 0 only; stream is %u-bit",
                        gfx::BitDepthForColorDepth(mVideoInfo.mColorDepth));
  } else if (mVideoInfo.mImage.width < 16 || mVideoInfo.mImage.height < 16 ||
             mVideoInfo.mImage.width > 8192 ||
             mVideoInfo.mImage.height > 8192) {
    mFailureReason =
        nsPrintfCString("VP9 DXVA2 does not accept a coded size of %dx%d",
                        mVideoInfo.mImage.width, mVideoInfo.mImage.height);
  }

  if (!mFailureReason.IsEmpty()) {
    return MediaResult(NS_ERROR_DOM_MEDIA_FATAL_ERR, mFailureReason);
  }

  mDXVA2Manager.reset(DXVA2Manager::CreateD3D9DXVA(
      mKnowsCompositor, mFailureReason, &DXVAVP9Manager::GetVP9DecoderGUID()));
  if (!mDXVA2Manager) {
    if (mFailureReason.IsEmpty()) {
      mFailureReason.AssignLiteral(
          "Could not create a D3D9 DXVA2 device for the VP9 profile-0 GUID");
    }
    return MediaResult(NS_ERROR_DOM_MEDIA_FATAL_ERR, mFailureReason);
  }

  auto decoder = MakeUnique<DXVAVP9Manager>();
  if (!decoder->Init(mDXVA2Manager->GetDXVADeviceManager(),
                     mVideoInfo.mImage.width, mVideoInfo.mImage.height,
                     mFailureReason)) {
    Shutdown();
    if (mFailureReason.IsEmpty()) {
      mFailureReason.AssignLiteral(
          "Could not initialize the VP9 DXVA2 decoder");
    }
    return MediaResult(NS_ERROR_DOM_MEDIA_FATAL_ERR, mFailureReason);
  }

  mVP9Decoder = std::move(decoder);
  mIsValid = true;
  mFailureReason.AssignLiteral("Using VP9 DXVA2 profile 0");
  return NS_OK;
}

HRESULT WMFVP9DXVA2Manager::Input(MediaRawData* aSample) {
  if (!mIsValid || !mVP9Decoder || !mDXVA2Manager) {
    return E_UNEXPECTED;
  }
  if (!aSample || !aSample->Data() || aSample->Size() > UINT32_MAX ||
      !aSample->mTime.IsValid() || !aSample->mDuration.IsValid() ||
      aSample->mDuration.IsNegative()) {
    return E_INVALIDARG;
  }

  const CheckedInt<int64_t> sampleEnd =
      CheckedInt<int64_t>(aSample->mTime.ToMicroseconds()) +
      aSample->mDuration.ToMicroseconds();
  if (!sampleEnd.isValid()) {
    return E_INVALIDARG;
  }

  uint32_t offsets[8];
  uint32_t sizes[8];
  uint32_t count = 0;
  if (!VP9SplitSuperframe(aSample->Data(), uint32_t(aSample->Size()), offsets,
                          sizes, count)) {
    return E_INVALIDARG;
  }

  AutoTArray<ShownFrame, 2> shown;
  for (uint32_t i = 0; i < count; ++i) {
    RefPtr<IDirect3DSurface9> surface;
    bool display = false;
    VP9FrameHeader header;
    HRESULT hr =
        mVP9Decoder->DecodeFrame(aSample->Data() + offsets[i], sizes[i],
                                 getter_AddRefs(surface), &display, &header);
    if (FAILED(hr)) {
      Flush();
      return hr;
    }
    if (!display) {
      continue;
    }
    if (mSeekTargetThreshold && TimeUnit::FromMicroseconds(sampleEnd.value()) <
                                    mSeekTargetThreshold.ref()) {
      continue;
    }

    const gfx::IntRect picture =
        mVideoInfo.ScaledImageRect(header.frameWidth, header.frameHeight);
    RefPtr<layers::Image> image;
    hr = mDXVA2Manager->CopySurfaceToImage(surface, picture,
                                           getter_AddRefs(image));
    if (FAILED(hr) || !image) {
      Flush();
      return FAILED(hr) ? hr : E_FAIL;
    }

    ShownFrame* frame = shown.AppendElement();
    frame->mImage = std::move(image);
    frame->mKeyframe = !header.showExistingFrame && header.frameType == 0;
  }

  if (shown.IsEmpty()) {
    return S_OK;
  }

  const int64_t sampleTime = aSample->mTime.ToMicroseconds();
  const int64_t sampleDuration = aSample->mDuration.ToMicroseconds();
  const int64_t sliceDuration = sampleDuration / shown.Length();
  for (size_t i = 0; i < shown.Length(); ++i) {
    const CheckedInt<int64_t> frameTime =
        CheckedInt<int64_t>(sampleTime) +
        CheckedInt<int64_t>(static_cast<int64_t>(i)) * sliceDuration;
    if (!frameTime.isValid()) {
      Flush();
      return E_INVALIDARG;
    }
    const int64_t duration = i + 1 == shown.Length()
                                 ? sampleEnd.value() - frameTime.value()
                                 : sliceDuration;
    if (mSeekTargetThreshold) {
      if (TimeUnit::FromMicroseconds(frameTime.value() + duration) <
          mSeekTargetThreshold.ref()) {
        continue;
      }
      mSeekTargetThreshold.reset();
    }
    RefPtr<VideoData> frame = VideoData::CreateFromImage(
        mVideoInfo.mDisplay, aSample->mOffset,
        TimeUnit::FromMicroseconds(frameTime.value()),
        TimeUnit::FromMicroseconds(duration), shown[i].mImage,
        shown[i].mKeyframe, TimeUnit::FromMicroseconds(-1));
    if (!frame) {
      Flush();
      return E_OUTOFMEMORY;
    }
    mPendingFrames.AppendElement(std::move(frame));
  }
  return S_OK;
}

HRESULT WMFVP9DXVA2Manager::Output(int64_t, RefPtr<MediaData>& aOutput) {
  aOutput = nullptr;
  if (mPendingFrames.IsEmpty()) {
    return MF_E_TRANSFORM_NEED_MORE_INPUT;
  }
  aOutput = std::move(mPendingFrames[0]);
  mPendingFrames.RemoveElementAt(0);
  return S_OK;
}

void WMFVP9DXVA2Manager::Flush() {
  mPendingFrames.Clear();
  mSeekTargetThreshold.reset();
  if (mVP9Decoder) {
    mVP9Decoder->Flush();
  }
}

void WMFVP9DXVA2Manager::Shutdown() {
  mPendingFrames.Clear();
  mSeekTargetThreshold.reset();
  mVP9Decoder.reset();
  mDXVA2Manager.reset();
  mIsValid = false;
}

bool WMFVP9DXVA2Manager::IsHardwareAccelerated(
    nsACString& aFailureReason) const {
  aFailureReason = mFailureReason;
  return mIsValid;
}

nsCString WMFVP9DXVA2Manager::GetDescriptionName() const {
  return "VP9 DXVA2 profile 0 hardware decoder"_ns;
}

}  // namespace mozilla
