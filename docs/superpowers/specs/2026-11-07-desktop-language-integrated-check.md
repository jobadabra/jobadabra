# Desktop integrated language check — mlf

7 November 2026. Implementation and evidence prepared; owner visual approval, commit, PR publication and exact-head READY are pending. This is a measured desktop check, not a whole-product completion claim.

## Baselines and scope

The initial 176 screenshots use `fd0f52bc`: 22 surfaces × German/Russian × light/dark × 1280/760-pixel windows. Another 64 narrow screenshots inspect five additional Profile tabs, two Strategy tabs and all nine job-drawer tabs. Targeted verification adds 88 screenshots after fixes, for 328 successful screenshot states altogether. Pictures and extracted visible text/attributes are in `/tmp/mlf-shots`, `/tmp/mlf-subpages`, `/tmp/mlf-after`, `/tmp/mlf-jobs-final`, `/tmp/mlf-final-subpages`, `/tmp/mlf-drawer-final`, `/tmp/mlf-focus-final` and `/tmp/mlf-tune-final` on the review machine.

The prepared branch was rebased to `30ff290b`, including the owner-merged rebuild-field-name follow-up [#3566](https://github.com/jobadabra/jobadabra/pull/3566). Its two named tests pass. Earlier merged work includes [#3526](https://github.com/jobadabra/jobadabra/pull/3526), [#3553](https://github.com/jobadabra/jobadabra/pull/3553) and [#3558](https://github.com/jobadabra/jobadabra/pull/3558).

Everything uses isolated fictional demo folders. No live app, owner profile/data, Keychain, paid AI, external message delivery or application submission was used. Generated reviews/portrait/report prose, original message subjects/bodies, historical free-form notes, CV text, saved questions/answers, names, places, URLs, brands and technical logs remain original. An English phrase inside that supplied content is not an untranslated UI label.

## Catalog measurement

Run `node desktop/scripts/catalog-audit.mjs /tmp/mlf-catalog-audit.json`. The script checks all bundled desktop catalogs, including native, Windows templates and diagnostic namespaces.

| Locale | Groups | Keys | Key gaps | Parameter gaps | Missing plural forms | Reviewed shared English spellings | Unreviewed English copies |
|---|---:|---:|---:|---:|---:|---:|---:|
| EN | 108 | 7,109 | 0 | 0 | 0 | 0 | 0 |
| DE | 108 | 7,109 | 0 | 0 | 0 | 53 | 0 |
| FR | 108 | 7,109 | 0 | 0 | 0 | 57 | 0 |
| IT | 108 | 7,109 | 0 | 0 | 0 | 50 | 0 |
| ES | 108 | 7,109 | 0 | 0 | 0 | 29 | 0 |
| RO | 108 | 7,109 | 0 | 0 | 0 | 46 | 0 |
| RU | 108 | 7,109 | 0 | 0 | 0 | 10 | 0 |

The 245 identical values are reviewed cognates/loanwords, product names, units or parameter-only templates. `desktop/scripts/catalog-shared-spellings.json` records their exact locale, key and value; a new copied English value fails. An isolated temporary catalog with German `chooseHelp` deliberately replaced by English produced one copy finding and exit 1.

There are 83 explicit English inheritance slots: existing Windows/diagnostic canonical sources remain the English owner, with `null` recording inheritance rather than copying those diagnostic templates. Thirty previously implicit English diagnostic keys now explicitly declare that contract. Their translated parameter sets are compared with each other; this does not pretend null slots contain a duplicated English message. Parameter parity is per complete message: a singular may spell out “one”. Invariant localized wording such as “Matches: {count}” does not need a plural map.

The strict baseline scan found 588 absent explicit categories across plural maps. The patch makes 498 maps explicit or invariant, and adds the Romance million-count category to the shared noun generator. It retains existing rendered wording: 758 plural maps and 16,269 selected/invariant values across 51 changed catalog files match the frozen baseline at counts 0, 1, 2, 5, 11, 21, 101, 1.5 and 1,000,000. Key parity alone is not surface coverage.

## Rendered surface result

Counts are confirmed untranslated app-owned strings remaining in the inspected states after the prepared fixes; supplied content described above is excluded. Main/settings rows have both widths and both themes per language; additional tabs have narrow light/dark renders. Unchanged surfaces retain their baseline evidence; changed surfaces have targeted after evidence and rendered contracts.

| Page / tab | DE | RU |
|---|---|---|
| Welcome | ✅ 0 | ✅ 0 |
| Focus | ✅ 0 | ✅ 0 |
| Jobs | ✅ 0 | ✅ 0 |
| Applying / session | ✅ 0 | ✅ 0 |
| Actions | ✅ 0 | ✅ 0 |
| Interviews | ✅ 0 | ✅ 0 |
| Calendar | ✅ 0 | ✅ 0 |
| Reports | ✅ 0 | ✅ 0 |
| Employers | ✅ 0 | ✅ 0 |
| Strategy / Your strategy | ✅ 0 | ✅ 0 |
| Profile / CV | ✅ 0 | ✅ 0 |
| Settings / Overview | ✅ 0 | ✅ 0 |
| Settings / Automation | ✅ 0 | ✅ 0 |
| Settings / Notifications | ✅ 0 | ✅ 0 |
| Settings / Apply | ✅ 0 | ✅ 0 |
| Settings / Connections | ✅ 0 | ✅ 0 |
| Settings / Data & backup | ✅ 0 | ✅ 0 |
| Settings / Appearance | ✅ 0 | ✅ 0 |
| Settings / Plan | ✅ 0 | ✅ 0 |
| Settings / Advanced | ✅ 0 | ✅ 0 |
| Settings / Credentials | ✅ 0 | ✅ 0 |
| Settings / Logs | ✅ 0 | ✅ 0 |
| Profile / Your details | ✅ 0 | ✅ 0 |
| Profile / Experience | ✅ 0 | ✅ 0 |
| Profile / What we learned | ✅ 0 | ✅ 0 |
| Profile / Cover letter | ✅ 0 | ✅ 0 |
| Profile / Your portrait | ✅ 0 | ✅ 0 |
| Strategy / Suggestions | ✅ 0 | ✅ 0 |
| Strategy / Scoring & results | ✅ 0 | ✅ 0 |
| Job drawer / Overview | ✅ 0 | ✅ 0 |
| Job drawer / Match | ✅ 0 | ✅ 0 |
| Job drawer / Description | ✅ 0 | ✅ 0 |
| Job drawer / Application | ✅ 0 | ✅ 0 |
| Job drawer / Documents | ✅ 0 | ✅ 0 |
| Job drawer / Interviews | ✅ 0 | ✅ 0 |
| Job drawer / Review | ✅ 0 | ✅ 0 |
| Job drawer / Messages | ✅ 0 | ✅ 0 |
| Job drawer / Timeline | ✅ 0 | ✅ 0 |

## Confirmed gaps and prepared fixes

- `desktop/renderer/session-state.js:120`: navigation counter/tooltips constructed English `N session(s)`, `need(s) you`, `open` and `filled`. All four buckets now use seven-language counted messages; count/tone and English behavior remain covered.
- `desktop/renderer/pages/strategy-suggestions.js:107`, `desktop/renderer/shared-counts.js:23`: `6 suggestions` bypassed catalogs through `countOne`. A keyed shared count now uses the same locale-aware noun/plural runtime. At line 192 the tuning card also ignored producer display recipes for `2 changes your results support` and `Leave out "Junior" titles, drop Paris`; it now reads their explicit title/detail recipes. Its summary and the known Not now / Not true menu labels are localized while dismissal state IDs remain canonical. The actual localized-window contract visits the Suggestions tab and fails without this consumer fix.
- `desktop/renderer/pages/employers.js:88`: stored `Employer`, `Feed found`, `No open jobs`, `Low relevance`, `No public feed`, `Your list`, `Find employers` and `Starter list` appeared literally. Fixed enum labels now translate for rows and feed-menu labels; option values, filters and unknown custom metadata stay canonical. `Manual watch` has the same binding.
- `desktop/renderer/pages/mail-switches.js:25`: `New matches`, `An application needs you`, `Applied for you`, `Weekly summary`, `Always on stopped working`, `Nothing found for days`, `What's new`, `News and tips`, `A new version and what changed`, and `Offers, tips, and a reminder if you have been away` appeared from fixed website preference IDs. The renderer projects those known IDs only; original payloads and switch callbacks stay unchanged. Automation and Apply reuse the same renderer.
- `desktop/renderer/pages/desktop-ai-changes.js:20`: `It moved to Your details; change it there.` appeared on Profile history. The two fixed app-authored undo explanations now translate; arbitrary explanations and original historical rows remain unchanged.
- `desktop/renderer/job-drawer/tab-messages.js:42`: `Interview scheduled` and `Confirmation received` bypassed existing translated stage labels; `🤝 Recruiter message` and `📥 Logged messages` bypassed fixed section labels at line 56. Display binding now translates those labels while retaining original subjects, bodies and section/control identities.
- `desktop/demo/focus.json:3`: older fictional rows lacked the producer display recipes already used by current engine output. Visible English included `Reply to … recruiter`, `Reply today`, `Open LinkedIn`, `Open email`, `Prepare for …`, `Interview Thu 08:30`, `Follow up with …`, `Follow up`, `you wrote …`, `4 days, no reply`, `Open chat`, `Issue detected`, `Review evidence`, `Prepared`, `Human reply`, `Interviews`, `Contacted you`, `Offers`, fixed funnel advice, `Reply to recruiters first, then review ready applications.`, and the `Recruiter pitch …`, interview guidance and `You wrote …` tooltip framing. Strategy's older tune fixture also showed `2 changes your results support`. Recipes now use the existing catalog keys and real summary/presentation producers. A structural assertion confirmed every original fixture value remains identical to main; only `displayCopy` was added.
- `desktop/renderer/style.css:451`: the Russian Fit heading overlaid the Role heading. Long column labels now wrap inside their own column. The actual rendered contract measures text geometry and fails without this rule.

## Tests and review

Only named test files were run. The main focused unit/contract batch passed 191 tests; compatibility checks add 34 cases and the final Strategy checks add 13 previously uncounted cases, for 238 unique named-file tests. Three prior assertions requiring absent English diagnostic keys now require explicit null inheritance and still forbid copied diagnostic templates. The actual Electron German/Russian rendered-page contract passed both cases, covering counters/tooltips, Strategy including Suggestions, Employers, notification rows/news, Focus recipes, message metadata, heading geometry and canonical callbacks/custom values. Rebuild-field-name tests from #3566 are included. New regression assertions were observed failing before their respective fixes. File-size and diff-whitespace checks pass.

Four labelled, same-scale side-by-sides were generated with `desktop/scripts/side-by-side.mjs`, inspected and opened with `open -a Preview`: `/tmp/mlf-previews/mlf-{de,ru}-{light,dark}-review.png`. The owner decision prompt is open. No visible commit has been made. The exact committed design-system report, PR body/assets, CI/Gitar supervision and PR link are completed after the required visual yes.

The Notion progress record has not been written by this worker: this session exposes no Notion connector and the brief forbids Keychain access. Integration discovery confirmed that Notion is available but not installed here; it was suggested without claiming a connection. The coordinator receives the complete measured report and may copy this evidence to the existing [record](https://app.notion.com/p/41162be8fd8681f9a8e8ce827978f676) using an available authorized connection. No duplicate record is needed.

## Progress

### 1. Measured verification

- [x] Run seven-language catalog parity and reviewed-copy audit (proof: desktop/scripts/catalog-audit.mjs).
- [x] Render primary/settings pages and inspect deeper tabs in DE/RU light/dark (proof: none: 240 audited states in the local screenshot folders listed above).
- [x] Prepare one integrated fix with failing-then-passing localized rendering contracts (proof: desktop/integration/app/integrated-language.test.js).

### 2. Owner review and delivery
- [ ] Obtain owner visual approval before committing visible changes.
- [ ] Publish one PR and supervise it to exact-head READY; owner merges.
- [ ] Add final PR link and coordinator-confirmed Notion evidence.
