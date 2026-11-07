// Screen catalog registration entrypoint, populated by the desktop screen migration PR.
// Invariant: bootstrap imports this module before importing page modules that render translated constants.
import './screens-pages.js';
import './screens-helpers.js';
