/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "nsButtonFrameRenderer.h"

#include <algorithm>

#include "gfxUtils.h"
#include "mozilla/ServoStyleSet.h"
#include "mozilla/dom/Element.h"
#include "mozilla/layers/RenderRootStateManager.h"
#include "nsCSSRendering.h"
#include "nsDisplayList.h"
#include "nsIFrame.h"
#include "nsITheme.h"
#include "nsPresContext.h"
#include "nsPresContextInlines.h"

using namespace mozilla;
using namespace mozilla::image;
using namespace mozilla::layers;

namespace mozilla {
class nsDisplayButtonBoxShadowOuter;
class nsDisplayButtonBorder;
class nsDisplayButtonForeground;
}  // namespace mozilla

nsButtonFrameRenderer::nsButtonFrameRenderer() : mFrame(nullptr) {
  MOZ_COUNT_CTOR(nsButtonFrameRenderer);
}

nsButtonFrameRenderer::~nsButtonFrameRenderer() {
  MOZ_COUNT_DTOR(nsButtonFrameRenderer);
}

void nsButtonFrameRenderer::SetFrame(nsIFrame* aFrame,
                                     nsPresContext* aPresContext) {
  mFrame = aFrame;
  ReResolveStyles(aPresContext);
}

nsIFrame* nsButtonFrameRenderer::GetFrame() { return mFrame; }

nsresult nsButtonFrameRenderer::DisplayButton(nsDisplayListBuilder* aBuilder,
                                              nsDisplayList* aBackground,
                                              nsDisplayList* aForeground) {
  if (!mFrame->StyleEffects()->mBoxShadow.IsEmpty()) {
    aBackground->AppendNewToTop<nsDisplayButtonBoxShadowOuter>(aBuilder,
                                                               GetFrame());
  }

  nsRect buttonRect =
      mFrame->GetRectRelativeToSelf() + aBuilder->ToReferenceFrame(mFrame);

  const AppendedBackgroundType result =
      nsDisplayBackgroundImage::AppendBackgroundItemsToTop(
          aBuilder, mFrame, buttonRect, aBackground);
  if (result == AppendedBackgroundType::None) {
    aBuilder->BuildCompositorHitTestInfoIfNeeded(GetFrame(), aBackground);
  }

  aBackground->AppendNewToTop<nsDisplayButtonBorder>(aBuilder, GetFrame(),
                                                     this);

  if (mInnerFocusStyle && mInnerFocusStyle->StyleBorder()->HasBorder() &&
      mFrame->IsThemed() &&
      mFrame->PresContext()->Theme()->ThemeWantsButtonInnerFocusRing()) {
    aForeground->AppendNewToTop<nsDisplayButtonForeground>(aBuilder, GetFrame(),
                                                           this);
  }
  return NS_OK;
}

void nsButtonFrameRenderer::GetButtonInnerFocusRect(const nsRect& aRect,
                                                    nsRect& aResult) {
  aResult = aRect;
  aResult.Deflate(mFrame->GetUsedBorderAndPadding());

  if (mInnerFocusStyle) {
    nsMargin innerFocusPadding(0, 0, 0, 0);
    mInnerFocusStyle->StylePadding()->GetPadding(innerFocusPadding);

    nsMargin framePadding = mFrame->GetUsedPadding();

    innerFocusPadding.top = std::min(innerFocusPadding.top, framePadding.top);
    innerFocusPadding.right =
        std::min(innerFocusPadding.right, framePadding.right);
    innerFocusPadding.bottom =
        std::min(innerFocusPadding.bottom, framePadding.bottom);
    innerFocusPadding.left =
        std::min(innerFocusPadding.left, framePadding.left);

    aResult.Inflate(innerFocusPadding);
  }
}

ImgDrawResult nsButtonFrameRenderer::PaintInnerFocusBorder(
    nsDisplayListBuilder* aBuilder, nsPresContext* aPresContext,
    gfxContext& aRenderingContext, const nsRect& aDirtyRect,
    const nsRect& aRect) {
  nsRect rect;

  PaintBorderFlags flags = aBuilder->ShouldSyncDecodeImages()
                               ? PaintBorderFlags::SyncDecodeImages
                               : PaintBorderFlags();

  ImgDrawResult result = ImgDrawResult::SUCCESS;

  if (mInnerFocusStyle) {
    GetButtonInnerFocusRect(aRect, rect);

    result &= nsCSSRendering::PaintBorder(aPresContext, aRenderingContext,
                                          mFrame, aDirtyRect, rect,
                                          mInnerFocusStyle, flags);
  }

  return result;
}

Maybe<nsCSSBorderRenderer>
nsButtonFrameRenderer::CreateInnerFocusBorderRenderer(
    nsDisplayListBuilder* aBuilder, nsPresContext* aPresContext,
    gfxContext* aRenderingContext, const nsRect& aDirtyRect,
    const nsRect& aRect, bool* aBorderIsEmpty) {
  if (mInnerFocusStyle) {
    nsRect rect;
    GetButtonInnerFocusRect(aRect, rect);

    gfx::DrawTarget* dt =
        aRenderingContext ? aRenderingContext->GetDrawTarget() : nullptr;
    return nsCSSRendering::CreateBorderRenderer(
        aPresContext, dt, mFrame, aDirtyRect, rect, mInnerFocusStyle,
        aBorderIsEmpty);
  }

  return Nothing();
}

ImgDrawResult nsButtonFrameRenderer::PaintBorder(nsDisplayListBuilder* aBuilder,
                                                 nsPresContext* aPresContext,
                                                 gfxContext& aRenderingContext,
                                                 const nsRect& aDirtyRect,
                                                 const nsRect& aRect) {
  nsRect buttonRect = aRect;
  ComputedStyle* context = mFrame->Style();

  PaintBorderFlags borderFlags = aBuilder->ShouldSyncDecodeImages()
                                     ? PaintBorderFlags::SyncDecodeImages
                                     : PaintBorderFlags();

  nsCSSRendering::PaintBoxShadowInner(aPresContext, aRenderingContext, mFrame,
                                      buttonRect);

  ImgDrawResult result =
      nsCSSRendering::PaintBorder(aPresContext, aRenderingContext, mFrame,
                                  aDirtyRect, buttonRect, context, borderFlags);

  return result;
}

void nsButtonFrameRenderer::ReResolveStyles(nsPresContext* aPresContext) {
  ServoStyleSet* styleSet = aPresContext->StyleSet();

  mInnerFocusStyle = styleSet->ProbePseudoElementStyle(
      *mFrame->GetContent()->AsElement(), PseudoStyleType::MozFocusInner,
      nullptr, mFrame->Style());
}

ComputedStyle* nsButtonFrameRenderer::GetComputedStyle(int32_t aIndex) const {
  switch (aIndex) {
    case NS_BUTTON_RENDERER_FOCUS_INNER_CONTEXT_INDEX:
      return mInnerFocusStyle;
    default:
      return nullptr;
  }
}

void nsButtonFrameRenderer::SetComputedStyle(int32_t aIndex,
                                             ComputedStyle* aComputedStyle) {
  switch (aIndex) {
    case NS_BUTTON_RENDERER_FOCUS_INNER_CONTEXT_INDEX:
      mInnerFocusStyle = aComputedStyle;
      break;
  }
}

namespace mozilla {

class nsDisplayButtonBoxShadowOuter : public nsPaintedDisplayItem {
 public:
  nsDisplayButtonBoxShadowOuter(nsDisplayListBuilder* aBuilder,
                                nsIFrame* aFrame)
      : nsPaintedDisplayItem(aBuilder, aFrame) {
    MOZ_COUNT_CTOR(nsDisplayButtonBoxShadowOuter);
  }
  MOZ_COUNTED_DTOR_OVERRIDE(nsDisplayButtonBoxShadowOuter)

  bool CreateWebRenderCommands(
      mozilla::wr::DisplayListBuilder& aBuilder,
      mozilla::wr::IpcResourceUpdateQueue& aResources,
      const StackingContextHelper& aSc,
      mozilla::layers::RenderRootStateManager* aManager,
      nsDisplayListBuilder* aDisplayListBuilder) override;

  bool CanBuildWebRenderDisplayItems();

  void Paint(nsDisplayListBuilder* aBuilder, gfxContext* aCtx) override;
  nsRect GetBounds(nsDisplayListBuilder* aBuilder,
                   bool* aSnap) const override;
  NS_DISPLAY_DECL_NAME("ButtonBoxShadowOuter", TYPE_BUTTON_BOX_SHADOW_OUTER)
};

nsRect nsDisplayButtonBoxShadowOuter::GetBounds(nsDisplayListBuilder* aBuilder,
                                                bool* aSnap) const {
  *aSnap = false;
  return mFrame->InkOverflowRectRelativeToSelf() + ToReferenceFrame();
}

void nsDisplayButtonBoxShadowOuter::Paint(nsDisplayListBuilder* aBuilder,
                                          gfxContext* aCtx) {
  nsRect frameRect = nsRect(ToReferenceFrame(), mFrame->GetSize());

  nsCSSRendering::PaintBoxShadowOuter(mFrame->PresContext(), *aCtx, mFrame,
                                      frameRect, GetPaintRect(aBuilder, aCtx));
}

bool nsDisplayButtonBoxShadowOuter::CanBuildWebRenderDisplayItems() {
  if (mFrame->StyleEffects()->mBoxShadow.IsEmpty()) {
    return false;
  }

  bool hasBorderRadius;
  bool nativeTheme =
      nsCSSRendering::HasBoxShadowNativeTheme(mFrame, hasBorderRadius);

  return !nativeTheme;
}

bool nsDisplayButtonBoxShadowOuter::CreateWebRenderCommands(
    mozilla::wr::DisplayListBuilder& aBuilder,
    mozilla::wr::IpcResourceUpdateQueue& aResources,
    const StackingContextHelper& aSc,
    mozilla::layers::RenderRootStateManager* aManager,
    nsDisplayListBuilder* aDisplayListBuilder) {
  if (!CanBuildWebRenderDisplayItems()) {
    return false;
  }
  int32_t appUnitsPerDevPixel = mFrame->PresContext()->AppUnitsPerDevPixel();
  nsRect shadowRect = nsRect(ToReferenceFrame(), mFrame->GetSize());
  LayoutDeviceRect deviceBox =
      LayoutDeviceRect::FromAppUnits(shadowRect, appUnitsPerDevPixel);
  wr::LayoutRect deviceBoxRect = wr::ToLayoutRect(deviceBox);

  bool dummy;
  LayoutDeviceRect clipRect = LayoutDeviceRect::FromAppUnits(
      GetBounds(aDisplayListBuilder, &dummy), appUnitsPerDevPixel);
  wr::LayoutRect deviceClipRect = wr::ToLayoutRect(clipRect);

  bool hasBorderRadius;
  (void)nsCSSRendering::HasBoxShadowNativeTheme(mFrame, hasBorderRadius);

  LayoutDeviceSize zeroSize;
  wr::BorderRadius borderRadius =
      wr::ToBorderRadius(zeroSize, zeroSize, zeroSize, zeroSize);
  if (hasBorderRadius) {
    gfx::RectCornerRadii borderRadii;
    hasBorderRadius = nsCSSRendering::GetBorderRadii(shadowRect, shadowRect,
                                                     mFrame, borderRadii);
    if (hasBorderRadius) {
      borderRadius = wr::ToBorderRadius(borderRadii);
    }
  }

  const Span<const StyleBoxShadow> shadows =
      mFrame->StyleEffects()->mBoxShadow.AsSpan();
  MOZ_ASSERT(!shadows.IsEmpty());

  for (const StyleBoxShadow& shadow : Reversed(shadows)) {
    if (shadow.inset) {
      continue;
    }
    float blurRadius =
        float(shadow.base.blur.ToAppUnits()) / float(appUnitsPerDevPixel);
    gfx::DeviceColor shadowColor =
        ToDeviceColor(nsCSSRendering::GetShadowColor(shadow.base, mFrame, 1.0));

    LayoutDevicePoint shadowOffset = LayoutDevicePoint::FromAppUnits(
        nsPoint(shadow.base.horizontal.ToAppUnits(),
                shadow.base.vertical.ToAppUnits()),
        appUnitsPerDevPixel);

    float spreadRadius =
        float(shadow.spread.ToAppUnits()) / float(appUnitsPerDevPixel);

    wr::BorderRadius shadowRadius = borderRadius;
    if (hasBorderRadius && spreadRadius) {
      gfx::RectCornerRadii shadowRadii;
      if (nsCSSRendering::GetBorderRadii(shadowRect, shadowRect, mFrame,
                                         shadowRadii)) {
        shadowRadii.AdjustOutwards(gfx::Margin(spreadRadius, spreadRadius,
                                               spreadRadius, spreadRadius));
        shadowRadius = wr::ToBorderRadius(shadowRadii);
      }
    }

    aBuilder.PushBoxShadow(deviceBoxRect, deviceClipRect, !BackfaceIsHidden(),
                           deviceBoxRect, wr::ToLayoutVector2D(shadowOffset),
                           wr::ToColorF(shadowColor), blurRadius, spreadRadius,
                           borderRadius, shadowRadius,
                           wr::BoxShadowClipMode::Outset);
  }
  return true;
}

class nsDisplayButtonBorder final : public nsPaintedDisplayItem {
 public:
  nsDisplayButtonBorder(nsDisplayListBuilder* aBuilder, nsIFrame* aFrame,
                        nsButtonFrameRenderer* aRenderer)
      : nsPaintedDisplayItem(aBuilder, aFrame), mBFR(aRenderer) {
    MOZ_COUNT_CTOR(nsDisplayButtonBorder);
  }
  MOZ_COUNTED_DTOR_OVERRIDE(nsDisplayButtonBorder)

  void HitTest(nsDisplayListBuilder* aBuilder, const nsRect& aRect,
               HitTestState* aState,
               nsTArray<nsIFrame*>* aOutFrames) override {
    aOutFrames->AppendElement(mFrame);
  }
  void Paint(nsDisplayListBuilder* aBuilder, gfxContext* aCtx) override;
  nsRect GetBounds(nsDisplayListBuilder* aBuilder,
                   bool* aSnap) const override;
  bool CreateWebRenderCommands(
      mozilla::wr::DisplayListBuilder& aBuilder,
      mozilla::wr::IpcResourceUpdateQueue& aResources,
      const StackingContextHelper& aSc,
      mozilla::layers::RenderRootStateManager* aManager,
      nsDisplayListBuilder* aDisplayListBuilder) override;
  NS_DISPLAY_DECL_NAME("ButtonBorderBackground", TYPE_BUTTON_BORDER_BACKGROUND)

 private:
  nsButtonFrameRenderer* mBFR;
};

bool nsDisplayButtonBorder::CreateWebRenderCommands(
    mozilla::wr::DisplayListBuilder& aBuilder,
    mozilla::wr::IpcResourceUpdateQueue& aResources,
    const StackingContextHelper& aSc,
    mozilla::layers::RenderRootStateManager* aManager,
    nsDisplayListBuilder* aDisplayListBuilder) {
  const nsRect buttonRect = nsRect(ToReferenceFrame(), mFrame->GetSize());
  bool snap;
  nsRect visible = GetBounds(aDisplayListBuilder, &snap);
  nsDisplayBoxShadowInner::CreateInsetBoxShadowWebRenderCommands(
      aBuilder, aSc, visible, mFrame, buttonRect);

  bool borderIsEmpty = false;
  Maybe<nsCSSBorderRenderer> br = nsCSSRendering::CreateBorderRenderer(
      mFrame->PresContext(), nullptr, mFrame, nsRect(),
      nsRect(ToReferenceFrame(), mFrame->GetSize()), mFrame->Style(),
      &borderIsEmpty, mFrame->GetSkipSides());
  if (!br) {
    return borderIsEmpty;
  }
  if (!br->CanCreateWebRenderCommands()) {
    return false;
  }

  br->CreateWebRenderCommands(this, aBuilder, aResources, aSc);
  return true;
}

void nsDisplayButtonBorder::Paint(nsDisplayListBuilder* aBuilder,
                                  gfxContext* aCtx) {
  NS_ASSERTION(mFrame, "No frame?");
  nsPresContext* pc = mFrame->PresContext();
  nsRect r = nsRect(ToReferenceFrame(), mFrame->GetSize());

  (void)mBFR->PaintBorder(aBuilder, pc, *aCtx, GetPaintRect(aBuilder, aCtx),
                          r);
}

nsRect nsDisplayButtonBorder::GetBounds(nsDisplayListBuilder* aBuilder,
                                        bool* aSnap) const {
  *aSnap = false;
  return aBuilder->IsForEventDelivery()
             ? nsRect(ToReferenceFrame(), mFrame->GetSize())
             : mFrame->InkOverflowRectRelativeToSelf() + ToReferenceFrame();
}

class nsDisplayButtonForeground final : public nsPaintedDisplayItem {
 public:
  nsDisplayButtonForeground(nsDisplayListBuilder* aBuilder, nsIFrame* aFrame,
                            nsButtonFrameRenderer* aRenderer)
      : nsPaintedDisplayItem(aBuilder, aFrame), mBFR(aRenderer) {
    MOZ_COUNT_CTOR(nsDisplayButtonForeground);
  }
  MOZ_COUNTED_DTOR_OVERRIDE(nsDisplayButtonForeground)

  void Paint(nsDisplayListBuilder* aBuilder, gfxContext* aCtx) override;
  bool CreateWebRenderCommands(
      mozilla::wr::DisplayListBuilder& aBuilder,
      mozilla::wr::IpcResourceUpdateQueue& aResources,
      const StackingContextHelper& aSc,
      mozilla::layers::RenderRootStateManager* aManager,
      nsDisplayListBuilder* aDisplayListBuilder) override;
  NS_DISPLAY_DECL_NAME("ButtonForeground", TYPE_BUTTON_FOREGROUND)

 private:
  nsButtonFrameRenderer* mBFR;
};

void nsDisplayButtonForeground::Paint(nsDisplayListBuilder* aBuilder,
                                      gfxContext* aCtx) {
  nsRect r = nsRect(ToReferenceFrame(), mFrame->GetSize());

  (void)mBFR->PaintInnerFocusBorder(aBuilder, mFrame->PresContext(), *aCtx,
                                    GetPaintRect(aBuilder, aCtx), r);
}

bool nsDisplayButtonForeground::CreateWebRenderCommands(
    mozilla::wr::DisplayListBuilder& aBuilder,
    mozilla::wr::IpcResourceUpdateQueue& aResources,
    const StackingContextHelper& aSc,
    mozilla::layers::RenderRootStateManager* aManager,
    nsDisplayListBuilder* aDisplayListBuilder) {
  Maybe<nsCSSBorderRenderer> br;
  bool borderIsEmpty = false;
  bool dummy;
  nsRect r = nsRect(ToReferenceFrame(), mFrame->GetSize());
  br = mBFR->CreateInnerFocusBorderRenderer(
      aDisplayListBuilder, mFrame->PresContext(), nullptr,
      GetBounds(aDisplayListBuilder, &dummy), r, &borderIsEmpty);

  if (!br) {
    return borderIsEmpty;
  }
  if (!br->CanCreateWebRenderCommands()) {
    return false;
  }

  br->CreateWebRenderCommands(this, aBuilder, aResources, aSc);

  return true;
}

}  // namespace mozilla