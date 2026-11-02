// The file the person chose for their own CLI ("Choose claude.exe" / "Choose codex.exe" in the AI chooser), kept in settings (claudeFile / codexFile) and read here by the finders
// (apply.js claudeBinary, ai/codex-cli.js codexBinary), which have no storage. Set once at start and on every pick (lib/setup-handlers.js).
// Why (2 Nov 2026, owner, a Windows tester): a CLI installed somewhere the app does not look is the person's to point at, never a raw folder list on the screen.
const chosen = {claude: '', openai: ''};
/** The file the person chose for a family ('claude' | 'openai'); '' when none. */
export const chosenFile = family => chosen[family] || '';
/** Remember the chosen file for a family (a non-string clears it). Called at start and on every pick. */
export const setChosenFile = (family, file) => { chosen[family] = typeof file === 'string' ? file : ''; };
export const SETTING = {claude: 'claudeFile', openai: 'codexFile'};

// The CLI's own last answer to "am I signed in?" (lib/plan-login.js, saved by every check as `login`): true / false, or null when never asked.
// Why (2 Nov 2026, review of [cc] 1/2): Apply with Claude's prerequisites still read ~/.claude.json, which Windows installs may not write, so the chooser said ready and Apply said "not signed in".
const known = {claude: null, openai: null};
/** The CLI's last own sign-in answer for a family: true, false, or null when never asked. */
export const knownSignedIn = family => known[family];
/** Keep the `login` verdict of a saved check ('signed-in' | 'signed-out'; anything else, or no record, is null). */
export const rememberLogin = (family, record) => { known[family] = record?.login === 'signed-in' ? true : record?.login === 'signed-out' ? false : null; };
