// The rows of what Always on never uses (your LinkedIn sign-in, Gmail & Calendar), as pure data: renderer/always-on-device-only.js draws them.

/** The rows, in order: [id, icon, title key, line key] (keys under helperMore). Guard: test/unit/renderer/always-on-device-only.test.js. */
export const ROWS = [
  ['linkedin', 'linkedin', 'deviceOnlyLinkedin', 'deviceOnlyLinkedinLine'],
  ['google', 'mail', 'deviceOnlyGoogle', 'deviceOnlyGoogleLine'],
];
