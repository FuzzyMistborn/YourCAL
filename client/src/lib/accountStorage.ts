// localStorage is shared by every account that logs into this browser
// (there's no local user store, no per-user storage partitioning) --
// without clearing these on logout, one user's subscription URLs,
// color overrides, and dismissed-share state stay readable by whoever
// logs in next on the same browser. Keys are duplicated here (rather
// than imported from each store) to avoid a circular import between the
// session store and the stores it needs to clear.
const ACCOUNT_SCOPED_KEYS = [
  'calendar.subscriptions',
  'calendar.colorOverrides',
  'calendar.dismissedPendingShares.v2',
]

export function clearAccountStorage(): void {
  for (const key of ACCOUNT_SCOPED_KEYS) {
    localStorage.removeItem(key)
  }
}
