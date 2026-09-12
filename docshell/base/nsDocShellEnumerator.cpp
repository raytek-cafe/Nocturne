/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include <utility>

#include "nsDocShellEnumerator.h"

#include "nsDocShell.h"
#include "nsSimpleEnumerator.h"

using namespace mozilla;

nsDocShellEnumerator::nsDocShellEnumerator(
    nsDocShellEnumerator::EnumerationDirection aDirection,
    int32_t aDocShellType, nsDocShell& aRootItem)
    : mRootItem(&aRootItem),
      mDocShellType(aDocShellType),
      mDirection(aDirection) {}

namespace {

class OwningDocShellEnumerator final : public nsSimpleEnumerator {
 public:
  explicit OwningDocShellEnumerator(
      nsTArray<RefPtr<nsIDocShell>>&& aItems)
      : mItems(std::move(aItems)) {}

  NS_DECL_NSISIMPLEENUMERATOR

  const nsID& DefaultInterface() override {
    return NS_GET_IID(nsIDocShell);
  }

 private:
  ~OwningDocShellEnumerator() override = default;

  nsTArray<RefPtr<nsIDocShell>> mItems;
  uint32_t mIndex = 0;
};

NS_IMETHODIMP
OwningDocShellEnumerator::HasMoreElements(bool* aResult) {
  if (!aResult) {
    return NS_ERROR_NULL_POINTER;
  }

  *aResult = mIndex < mItems.Length();
  return NS_OK;
}

NS_IMETHODIMP
OwningDocShellEnumerator::GetNext(nsISupports** aResult) {
  if (!aResult) {
    return NS_ERROR_NULL_POINTER;
  }
  if (mIndex >= mItems.Length()) {
    return NS_ERROR_UNEXPECTED;
  }

  RefPtr<nsISupports> item = mItems[mIndex++];
  item.forget(aResult);
  return NS_OK;
}

}  // namespace

nsresult NS_NewDocShellEnumerator(
    nsTArray<RefPtr<nsIDocShell>>&& aItems,
    nsISimpleEnumerator** aResult) {
  RefPtr enumerator =
      MakeRefPtr<OwningDocShellEnumerator>(std::move(aItems));
  enumerator.forget(aResult);
  return NS_OK;
}

nsresult nsDocShellEnumerator::BuildDocShellArray(
    nsTArray<RefPtr<nsIDocShell>>& aItemArray) {
  MOZ_ASSERT(mRootItem);

  aItemArray.Clear();

  if (mDirection == EnumerationDirection::Forwards) {
    return BuildArrayRecursiveForwards(mRootItem, aItemArray);
  }
  MOZ_ASSERT(mDirection == EnumerationDirection::Backwards);
  return BuildArrayRecursiveBackwards(mRootItem, aItemArray);
}

nsresult nsDocShellEnumerator::BuildArrayRecursiveForwards(
    nsDocShell* aItem, nsTArray<RefPtr<nsIDocShell>>& aItemArray) {
  nsresult rv;

  // add this item to the array
  if (mDocShellType == nsIDocShellTreeItem::typeAll ||
      aItem->ItemType() == mDocShellType) {
    if (!aItemArray.AppendElement(aItem, fallible)) {
      return NS_ERROR_OUT_OF_MEMORY;
    }
  }

  int32_t numChildren = aItem->ChildCount();

  for (int32_t i = 0; i < numChildren; ++i) {
    RefPtr<nsDocShell> curChild = aItem->GetInProcessChildAt(i);
    MOZ_ASSERT(curChild);

    rv = BuildArrayRecursiveForwards(curChild, aItemArray);
    if (NS_FAILED(rv)) {
      return rv;
    }
  }

  return NS_OK;
}

nsresult nsDocShellEnumerator::BuildArrayRecursiveBackwards(
    nsDocShell* aItem, nsTArray<RefPtr<nsIDocShell>>& aItemArray) {
  nsresult rv;

  uint32_t numChildren = aItem->ChildCount();

  for (int32_t i = numChildren - 1; i >= 0; --i) {
    RefPtr<nsDocShell> curChild = aItem->GetInProcessChildAt(i);
    MOZ_ASSERT(curChild);

    rv = BuildArrayRecursiveBackwards(curChild, aItemArray);
    if (NS_FAILED(rv)) {
      return rv;
    }
  }

  // add this item to the array
  if (mDocShellType == nsIDocShellTreeItem::typeAll ||
      aItem->ItemType() == mDocShellType) {
    if (!aItemArray.AppendElement(aItem, fallible)) {
      return NS_ERROR_OUT_OF_MEMORY;
    }
  }

  return NS_OK;
}
