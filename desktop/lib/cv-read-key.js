// What names the app's CV read: its file and the hash of the CV it belongs to. Imports nothing but node:, so the e2e harness can read them without loading the app's AI code.
// Why (4 Nov 2026, main run 41805737631): agent-seed.mjs took both from cv-check.js and cv-queue.js, which reach @anthropic-ai/sdk; the plan job installs only desktop/e2e's packages and died on it. Guard: desktop/e2e/test/pool/suite-imports.test.mjs.
import crypto from 'node:crypto';
import fs from 'node:fs';

/** The file (in the data folder) where the app keeps the answer of its CV read. */
export const FILE = 'cv/fact-proposals.json';

/** The first 16 hex of the sha256 of the data folder's cv.pdf, '' when there is none: the key a read and a check are saved under, so another CV discards them. */
export const hashOf = storage => { try { return crypto.createHash('sha256').update(fs.readFileSync(storage.path('cv.pdf'))).digest('hex').slice(0, 16); } catch { return ''; } };
