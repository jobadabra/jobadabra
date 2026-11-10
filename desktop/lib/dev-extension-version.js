// The version a development copy (Chrome loads the checkout's extension/ itself) is told to be at: the manifest's base plus the number of commits that changed extension/ (the same stamp a build gets, desktop/scripts/extension-stamp.mjs), so a pulled change reaches the running extension.
// Guarded by desktop/test/unit/extension/dev-extension-version.test.js.
// Why (10 Nov 2026, hw): this used to ask git for the count itself, synchronously, on every check-in (3.4 s of a 4 s freeze in a profile of the main thread). The count now comes from
// lib/build-state.js checkoutCommits, the one owner of that git fact, refreshed asynchronously; this file only turns it into a version.

// manifestVersion "0.9" or "0.9.12", commits = how many commits changed extension/ (0 when not known yet, no git, a shallow clone) -> "0.9.<commits>"; the manifest's own when commits is 0.
export function devVersion(manifestVersion, commits) {
  return Number.isInteger(commits) && commits > 0 ? `${String(manifestVersion).split('.').slice(0, 2).join('.')}.${commits}` : manifestVersion;
}
