// The Show / Hide button on the right of a Jobs fold's summary (owner, 5 Nov 2026: "\"Show\" doesn't look like a button, but rather like a text"): one word for every `.jobs-fold`
// (Suggestions for your search, In conversation), drawn by style.css `.fold-toggle` in the look of the app's small secondary button. Guarded by test/unit/renderer/fold-toggle.test.js.
export const foldToggleWord = open => (open ? 'Hide' : 'Show');
