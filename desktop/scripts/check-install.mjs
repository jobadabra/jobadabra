// Refuse dev-start installs through shared node_modules, or one holding any link named node_modules, without changing any link or target.
import {lstatSync} from 'node:fs';

// Why (30 Oct 2026, owner): prestart bypasses the agent hook; check before invoking npm so every caller is protected.
try {
  if (lstatSync(new URL('../node_modules', import.meta.url)).isSymbolicLink()) {
    console.error('Install refused: desktop/node_modules is a link; run tools/worktree.sh own-modules desktop from the repo root, then retry.');
    process.exitCode = 1;
  } else {
    // Why (#3423, 7 Nov 2026; first seen 30 Oct, 67fbdacd): a link named node_modules INSIDE the folder (what ln -s leaves when its second argument, desktop/node_modules, is already a link to a folder)
    // is suspected, not reproduced, of causing npm's ENOTEMPTY rename error on desktop/node_modules/node_modules/ajv. Producer unproven; this only names the link to remove, it removes nothing.
    try {
      if (lstatSync(new URL('../node_modules/node_modules', import.meta.url)).isSymbolicLink()) {
        console.error('Install refused: desktop/node_modules/node_modules is a link inside the modules folder; remove that one link (rm desktop/node_modules/node_modules from the repo root, never the folder), then retry.');
        process.exitCode = 1;
      }
    } catch (nested) {
      if (!['ENOENT', 'ENOTDIR'].includes(nested.code)) throw nested;   // a real folder or nothing there is fine
    }
  }
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.error(`Install refused: cannot check desktop/node_modules: ${error.message}`);
    process.exitCode = 1;
  }
}
