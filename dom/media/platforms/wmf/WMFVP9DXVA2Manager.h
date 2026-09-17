/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef WMFVP9DXVA2Manager_h_
#define WMFVP9DXVA2Manager_h_

#include "DXVA2Manager.h"
#include "DXVAVP9Manager.h"
#include "MediaInfo.h"
#include "WMFMediaDataDecoder.h"
#include "mozilla/UniquePtr.h"
#include "nsTArray.h"

namespace mozilla {

class WMFVP9DXVA2Manager final : public MFTManager {
 public:
  WMFVP9DXVA2Manager(const VideoInfo& aConfig,
                     layers::KnowsCompositor* aKnowsCompositor,
                     layers::ImageContainer* aImageContainer);
  ~WMFVP9DXVA2Manager() override;

  MediaResult Init();
  HRESULT Input(MediaRawData* aSample) override;
  HRESULT Output(int64_t aStreamOffset, RefPtr<MediaData>& aOutput) override;
  void Flush() override;
  void Drain() override {}
  void Shutdown() override;

  bool IsHardwareAccelerated(nsACString& aFailureReason) const override;
  TrackInfo::TrackType GetType() override { return TrackInfo::kVideoTrack; }
  nsCString GetDescriptionName() const override;
  nsCString GetCodecName() const override { return "vp9"_ns; }

 private:
  struct ShownFrame {
    RefPtr<layers::Image> mImage;
    bool mKeyframe = false;
  };

  const VideoInfo mVideoInfo;
  RefPtr<layers::KnowsCompositor> mKnowsCompositor;
  RefPtr<layers::ImageContainer> mImageContainer;
  UniquePtr<DXVA2Manager> mDXVA2Manager;
  UniquePtr<DXVAVP9Manager> mVP9Decoder;
  nsTArray<RefPtr<MediaData>> mPendingFrames;
  nsCString mFailureReason;
  bool mIsValid = false;
};

}  // namespace mozilla

#endif  // WMFVP9DXVA2Manager_h_
