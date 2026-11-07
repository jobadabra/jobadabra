// The one map from a finding's source to the name its GitHub issues carry in the title ("[AI persona] jobs: Applied tile shows 1…"), and the one reader of that title.
// Job: report health
// Why (7 Nov 2026, pz, owner via mac-50: "auto-ui prefix in Github issues is AI Code Review or AI Screenshot Review or UI Finder? Or bug loop or what?" → "One prefix per method (Recommended)": "New issues read [AI code review] …, [AI screenshot] …, [Layout check] …, [Test step] …. The auto-ui label stays, so the loop's counting and matching keep working. Open issues are renamed once."):
// the title says which method found the bug; the `auto-ui` label and the `fp:` fingerprint are untouched, so counting and matching do not change. Every reader of a title takes its tag and view through this file (TAG is built from the map),
// never a regex or a list of names of its own: a new source is one line in PREFIXES and every reader follows.
// Guard: desktop/e2e/test/pool/finder-prefix.test.mjs (every source files with its prefix and the view is read back from each).

/** Source label (`source:<name>` on the issue) -> the name in the title's brackets. */
export const PREFIXES = {
  'code-review': 'AI code review',
  'ai-review': 'AI screenshot',
  'layout-check': 'Layout check',
  'suite-failure': 'Test step',
  'ai-user-agent': 'AI persona',
  explorer: 'AI explorer',
  'interaction-probe': 'Interaction check',
  'desktop-tester': 'Desktop tester',
};

/** The tag of every issue filed before 7 Nov 2026 and of a source the map does not know: kept readable, and the fallback for a new source until it has a line above. */
export const LEGACY_TAG = 'auto-ui';

/** The bracket name a finding of this source gets in its title. */
export const prefixOf = source => PREFIXES[source] || LEGACY_TAG;

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const names = [...new Set([...Object.values(PREFIXES), LEGACY_TAG])].sort((a, b) => b.length - a.length);
/** A regex source matching any tag at the start of a title, written `\[<name>\]` for every name in the map and the legacy one. */
export const TAG = `\\[(?:${names.map(escape).join('|')})\\]`;

/** `[<prefix>] <view>: <text>`, at most 120 characters. */
export const titleOf = (source, view, text) => `[${prefixOf(source)}] ${view}: ${text}`.slice(0, 120);

/** The title without its tag and the space after it. A title with no known tag comes back as it was. */
export const stripTag = title => String(title || '').replace(new RegExp(`^${TAG}\\s*`), '');

/** The title's text without its tag and its `<view>:`, as the verdict and the lessons quote it. */
export const textOfTitle = title => String(title || '').replace(new RegExp(`^${TAG}\\s*[^:]*:\\s*`), '');

/** The view named in a title (`[<tag>] <view>: …`), or '' when the title has no known tag or no view. */
export const viewOfTitle = title => new RegExp(`^${TAG} ([^:]+):`).exec(String(title || ''))?.[1] || '';
