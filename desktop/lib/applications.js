// On the Mac the app belongs in Applications: opened from the disk image (or from Downloads, where macOS runs
// a read-only copy) it can't update itself and loses its keychain access when the disk image is ejected.
// At start it offers to move itself there; Electron copies it, quits and opens the moved copy.

import {applicationsMoveOptions, applicationsReplaceOptions, applicationsFailureOptions} from './native-notices.js';

// Whether to ask: packaged Mac builds outside Applications only.
export function shouldOffer({platform, packaged, inApplications}) {
  return platform === 'darwin' && packaged && !inApplications;
}

// Keep the exported options contract while resolving each text property in the current locale.
export const question = {
  type: 'question',
  get message() { return applicationsMoveOptions().message; },
  get detail() { return applicationsMoveOptions().detail; },
  get buttons() { return applicationsMoveOptions().buttons; },
  defaultId: 0,
  cancelId: 1,
};

// Ask, and move when the user agrees. Returns true when the app is moving (and about to quit).
// A copy already in Applications (an older version) is replaced after asking.
export function offerMove({app, dialog, platform = process.platform}) {
  // isInApplicationsFolder exists on the Mac only: asked after the platform check.
  if (!shouldOffer({platform, packaged: app.isPackaged, inApplications: platform === 'darwin' && app.isInApplicationsFolder()})) return false;
  if (dialog.showMessageBoxSync(question) !== 0) return false;
  try {
    return app.moveToApplicationsFolder({conflictHandler: kind => kind !== 'existsAndRunning' &&
      dialog.showMessageBoxSync(applicationsReplaceOptions()) === 0});
  } catch (error) {
    dialog.showMessageBoxSync(applicationsFailureOptions(error.message));
    return false;
  }
}
