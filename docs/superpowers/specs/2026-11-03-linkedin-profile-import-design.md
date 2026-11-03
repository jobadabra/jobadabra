# Import your profile from LinkedIn (Member Data Portability API)

> [!NOTE]
> **Verdict:** "Import from LinkedIn" fills the person's Experience, Education, Skills and Languages (and empty Your details lines) from their own LinkedIn profile, after they consent on LinkedIn's own page. It is one more way in at the CV step (no new step) and a button on Profile. Nothing is overwritten: every row they pick is added beside what they have. Their profile data goes from LinkedIn to their Mac, never through our server. The access key stays in the Mac's Keychain (up to 60 days, owner's call) so "Update from LinkedIn" needs no new sign-in; Disconnect deletes it. Members in the EU/EEA/Switzerland only (LinkedIn's rule); everyone else keeps the data-file way that exists today.
> Status: **spec for the owner's yes** (3 Nov 2026). Build starts after it.

## Why and who gets what
- LinkedIn provisioned our app **264991117 "Jobadabra"** for **Member Data Portability API (3rd Party)**, Default Tier (e-mail of 2 Nov 2026 23:25, CRM:015285039074544).
- Owner, 2 Nov 2026: "we want LinkedIn for just Data Member Portability, just for filling up his Profile, CV, Experience".
- Today a person gets LinkedIn's data into the app only by requesting an archive on LinkedIn, waiting, and choosing a .zip (`lib/linkedin-export.js`, `experienceAddLinkedin`). The CV step has a disabled "From LinkedIn / Coming soon" button (`renderer/index.html`, `#cv-linkedin`).
- Outcome: LinkedIn members in the EU/EEA/CH go from "no CV yet" or "CV missing my education and skills" to a filled Profile in about a minute, with one consent click on LinkedIn.

## The flow
| # | Who | What |
|---|---|---|
| 1 | Person | Presses **Import from LinkedIn** (Profile, or the CV step's third way in). A dialog says what is read and what is not. |
| 2 | App | Makes a random `state`, waits for it, and opens `https://www.jobadabra.top/api/linkedin-import/start?state=<state>` in their default browser. |
| 3 | Site | Redirects to LinkedIn's `oauth/v2/authorization` with `scope=r_dma_portability_3rd_party` and that `state`. |
| 4 | Person | Signs in and consents **on LinkedIn's page** (Jobadabra never sees or stores a password; passkey and Google/Apple sign-in work there). |
| 5 | Site | `/callback` exchanges the one-time code for an access token (needs the client secret) and answers the browser with a page that **POSTs the key to the app's own socket** `http://127.0.0.1:47111/linkedin-import/callback` (a form body, so the key never sits in the browser history; the one shared hand-off `shared/oauth-handoff.js` / `lib/oauth-handoff.js`, also used by Notion connect and LinkedIn sign-in). It keeps nothing: no store, no polling route. |
| 6 | App | Its local server takes the token **only for the `state` it made and is waiting on, once**; the browser tab says "Connected, go back to Jobadabra" and strips the URL. |
| 7 | App | Calls LinkedIn **directly from the Mac**: `GET https://api.linkedin.com/rest/memberSnapshotData?q=criteria&domain=<D>` with `Linkedin-Version: 202312` and `Authorization: Bearer …`, for 5 domains. |
| 8 | App | Shows **What came in** (below). The person picks. Ticked rows are saved. |
| 9 | App | Saves the token in the Keychain with its expiry (60 days). Later **Update from LinkedIn** reads the five lists again with no new sign-in. **Disconnect** deletes it. |

<details><summary>Cited facts (LinkedIn docs, read 3 Nov 2026)</summary>

- Product and scope: `r_dma_portability_3rd_party` ("Provides access to LinkedIn member data to developers upon member authorization"). [Member Data Portability (3rd Party)](https://learn.microsoft.com/en-us/linkedin/dma/member-data-portability/member-data-portability-3rd-party/)
- Snapshot endpoint, `Linkedin-Version: 202312` only (other versions fail `426 NONEXISTENT_VERSION`), optional `domain`, `paging.start/count/links`, "continue looping through the pages until you receive an error message indicating 'No data found for this memberId'" because some data comes from offline systems. [Member Snapshot API](https://learn.microsoft.com/en-us/linkedin/dma/member-data-portability/shared/member-snapshot-api)
- Domains are case sensitive: `PROFILE`, `POSITIONS`, `EDUCATION`, `SKILLS`, `LANGUAGES` (also `CERTIFICATIONS`, `PROJECTS`, `VOLUNTEERING_EXPERIENCES`, … not used here). [Snapshot domains](https://learn.microsoft.com/en-us/linkedin/dma/member-data-portability/shared/snapshot-domain)
- OAuth: redirect URLs are absolute **HTTPS** and must match the app's registered ones; token exchange takes `client_secret`; code lives 30 minutes; tokens live 60 days; "if you request a different scope than the previously granted scope, all the previous access tokens are invalidated". [3-legged OAuth](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
- "Only LinkedIn users from the European Economic Area are allowed to consent" (LinkedIn's help page adds Switzerland and says others "will receive error messages"). [Member portability APIs](https://www.linkedin.com/help/linkedin/answer/a6214075)
- After consent LinkedIn also archives the member's later activity for a Changelog API. **We never call it**; the dialog and the privacy page say so.
</details>

## What comes back and where it goes
Field names are the ones of LinkedIn's own data export (`Positions.csv`, …): the docs' `PROFILE` sample uses the same headers (`First Name`, `Geo Location`, `Summary`, …). **Assumption to verify on the first live response** (owner's own try); a missing column is reported by name, never guessed (same rule as `toCv`).

| Domain | Fields read | Goes to | How |
|---|---|---|---|
| `PROFILE` | First/Last Name, Headline, Summary, Geo Location, Zip Code, Address, Websites | CV name, summary, location; **Your details** (name, city, postal code, street, website) | Structure only. Only **empty** Your details lines are proposed. Birth Date, Maiden Name, Instant Messengers, Twitter are not read. |
| `POSITIONS` | Company Name, Title, Description, Location, Started On, Finished On | Experience: jobs and roles | `toCv` (reused): bullets from Description, one company with several roles grouped. |
| `EDUCATION` | School Name, Degree Name, Start Date, End Date | Experience: Education | `toCv`. |
| `SKILLS` | Name | Experience: Skills | `toCv`. |
| `LANGUAGES` | Name, Proficiency | Experience: Languages | `toCv`. |

**Mapping is structure; meaning is the AI's.** Which main-CV role a LinkedIn position is, and which bullets add something, is the existing AI match (`experience.matchAgainst`, fixed integers the code validates). No new rule tree.

## Merging: never overwrite silently
A **What came in** sheet (same look as the details review: rows with a checkbox, a "new" / "same" / "differs" chip, two columns when they differ).

| Section | Row | Chip | Default |
|---|---|---|---|
| Positions | A LinkedIn position the main CV already has (AI match) | same · or "n new bullets" | Ticked only if it adds bullets |
| Positions | A position the main CV lacks | new | Ticked |
| Education / Skills / Languages | Not in the CV | new | Ticked |
| Education / Skills / Languages | Already in the CV | same | Not shown (count only: "12 skills you already have") |
| Your details | Empty line, LinkedIn has a value | new | Ticked |
| Your details | Line has a value, LinkedIn's differs | differs (yours · LinkedIn) | **Unticked**, never replaces unless ticked |

- **Person already has a main CV (Profile):** ticked rows are saved as the one LinkedIn source of the experience bank (`experience.addLinkedin` path; a new import replaces the old LinkedIn source after it was read and matched). The main CV is never edited. Tailoring uses it as it does today. Ticked Your details rows go through the existing proposal path (`contact-from-cv` shape, `how: from LinkedIn`).
- **No main CV (CV step):** the mapped profile becomes the main CV like "Build with AI" does (`cv-build.saveBuilt`: CV + rendered PDF, marked as already read), after the same sheet with everything ticked and nothing to compare. They fix anything in Preview CV. Setup continues as with a chosen CV (`details-at-setup`).

## Who can use it
| Person | Sees |
|---|---|
| EU/EEA/Switzerland member | Button works. |
| Anyone else | The button is shown (we cannot know a member's country before LinkedIn does) with one line under it: **"For LinkedIn members in the EU, EEA and Switzerland. Elsewhere, use your LinkedIn data file."** and the data-file link in the same dialog. LinkedIn's own page refuses them; if it never returns, the dialog's wait ends after 5 minutes with the same line. |
| Callback with `error` (declined, refused) | The site's card says what LinkedIn said (`error_description`, first 200 chars) and "Go back to Jobadabra". The app shows it plus the data-file link. |

## Where the token lives
- **Site: nowhere.** The token is in the site's memory for the one request that trades the code and hands it over (no store, no log). **Why (3 Nov 2026, Gitar on web#336):** the first design held it under an id the app chose and gave it to whoever polled with that id, so an attacker's `/start?session=<id>` link plus a victim's consent handed the victim's 60-day key to the attacker. Now the key can only land on the machine of the browser that consented, and the app takes it only for a `state` it made. An attacker's link makes the victim's browser send the key to the victim's own socket with a `state` nobody there is waiting on: dropped unread. The same shape was in the Notion and sign-in flows: fixed by web#337 / jobadabra#3033 (the shared hand-off).
- **If the app is not running** when the browser returns, the post finds nothing on 47111 and the browser shows its own "can't connect"; nothing is stored anywhere and the person presses Import again.
- **App: Keychain** (`jobadabra.linkedin.dma_token`, account `jobadabra`; owner, 3 Nov 2026: memory-only is "not ok", it would be lost at the next restart). Only the settings hold when it was connected and when it expires (no value). It survives restarts for up to 60 days (LinkedIn's lifetime; no programmatic refresh for this product, so at expiry the person signs in again, one click). Never in settings, the store, logs, Notion or an upload.
- **What keeps it safe:** (a) the Keychain item is deleted by **Disconnect**, at expiry, on any 401, and when the person turns the import off; (b) it is read only inside `lib/linkedin-import.js` at the moment of an Import / Update press, never at startup, never by a background job; (c) it goes to `api.linkedin.com` only, over HTTPS; (d) the snapshot calls are limited to the five domains above.
- **Why it matters that it is kept:** LinkedIn's snapshot is taken "at a point in time when an API call is made", so with a kept key **Update from LinkedIn** brings a new job or skill into the sheet without a new consent. The cost: a standing 60-day credential that could read more than we use (messages, connections). Disconnect and the privacy page say so.
- **Disconnect** also asks LinkedIn to revoke the grant if its token-revoke endpoint works for this product (the site calls it, it holds the secret; **to verify in PR 1** against the live app, not assumed). If not, the dialog links to LinkedIn's Data privacy → permitted services page where consent is withdrawn.
- **Client secret:** Keychain `jobadabra.linkedin.dma_client_secret` (account `jobadabra`) and the Worker secret `LINKEDIN_IMPORT_CLIENT_SECRET`; never in the app, repo or docs. The app holds only the public client id in the Worker's var.
- **Logs:** `appLog('linkedin-import', 'imported', {positions: n, …})` counts only. The feedback redactor (`feedback-bundle.js`) learns the token shape; a test feeds a log full of fake tokens and fake profile text.

## Where the OAuth redirect lands: through the site
Decision: **the site (`https://www.jobadabra.top/api/linkedin-import/callback`), app 264991117; not a loopback.**
1. LinkedIn's docs require absolute HTTPS redirect URLs registered in the app; a loopback `http://127.0.0.1:port` is not a documented option.
2. The token exchange needs the **client secret**. The desktop app and extension are in a public repo and run on every person's machine; a secret there is published.
3. LinkedIn's redirect stays on the site (HTTPS); from there the key goes to the app's own socket (the extension's port, `lib/server-listen.js`), which is the one address that is the consenting person's machine and no one else's.
4. A separate Worker file and separate vars (`LINKEDIN_IMPORT_CLIENT_ID/SECRET`) from the sign-in app 264977227: different scope, and a new scope request on one app would invalidate the other's tokens.

What the site does not do: keep the key, or fetch the snapshot. The profile data goes LinkedIn → the Mac. That keeps the privacy page's "not on our servers" true for the data itself.

## Non-goals
- Anything about **LinkedIn jobs** (nothing on the site or in this dialog; `jobadabra-web#332` and its switch stay held and untouched).
- Other domains (connections, messages, posts, certifications, projects): not read. Certifications and volunteering are parked if people ask.
- A background or scheduled sync (the key is used only when the person presses Import or Update); the Changelog API.
- A new wizard step: the wizard stays AI → CV → Strategy.
- Replacing the data-file way (zip / PDF): it stays for non-EEA members.
- A change to "Connect with LinkedIn" (identity).

## Privacy page check (jobadabra-web#331, `website/public/privacy.html`, "Import your LinkedIn profile")
| The page says | What we build | Fix |
|---|---|---|
| "your positions, education, skills and name" | Also languages and the profile's location, postal code, street, website | Add them |
| "The data is kept in your own store … not on our servers" | True for the data. The one-time access key passes our server only for the request that hands it to the app on your computer; it is not stored there | Say so in one sentence |
| "only when you press Import" | True, plus Update from LinkedIn when pressed | Name Update |
| (nothing about the key) | The key passes our server for the one request that hands it to the app on your computer and is not stored; the app keeps it in the Keychain up to 60 days; Disconnect deletes it | Add one sentence |
| "withdraw your consent on LinkedIn" | True | Add that LinkedIn then prepares and archives data for this app until withdrawn, and that the app never reads that archive |
| "the text goes only to the AI you chose … Free AI through Workers AI" | The AI match runs on the AI they chose, as for CV versions | none |

These edits ride in the site PR below; nothing about LinkedIn jobs.

## Plan: 3 PRs, site first
| PR | Repo | What the user sees / gets | Tests |
|---|---|---|---|
| 1/3 | jobadabra-web | Nothing yet. The Worker runs the consent and passes the token to the app's socket, keeping nothing; the privacy page matches. Needed by 2 and 3. | `test/api/linkedin-import.test.js`: fake LinkedIn token endpoint, an attacker's link cannot move the token, error cards, revoke |
| 2/3 | jobadabra | **Profile → Import from LinkedIn / Update / Disconnect** + the What-came-in sheet; saved to the experience bank and Your details | Recorded-response fixtures served by a stand-in host (paging, empty domain, "No data found for this memberId", 401/403/429 stop, 426); mapping + merge unit tests; integration test with a fake Worker and fake LinkedIn; token-in-logs test; light + dark preview |
| 3/3 | jobadabra | **CV step: "From LinkedIn"** enabled; builds the main CV | Same stand-in; wizard integration test; light + dark preview |

Never the live API in CI. Fixtures start hand-built from the docs' samples and are replaced by the owner's try, scrubbed to fake data (real data is never committed). Before PR 1 merges, the redirect URLs go into app 264991117's Auth tab (`https://www.jobadabra.top/api/linkedin-import/callback` and the workers.dev one) and the Worker secret is set.

**Tier placement (proposal for mac-07; `critical-journeys.json` not edited):** Tier 2, integration only. Its proof needs a real EU member's consent on LinkedIn, which CI cannot give. The integration test covers app + Worker contract on recorded responses; the owner's real try is the live proof.

## Acceptance criteria
1. On Profile, Import from LinkedIn opens the person's browser at LinkedIn's own page; no password is typed in or stored by Jobadabra.
2. After consent, the sheet lists new / same / differs rows per section within 2 minutes, with per-domain progress and a Check again for a domain that has not arrived.
3. Nothing is added or changed until a row is ticked; a differing Your details line is unticked by default and never replaced silently.
4. Ticked positions, education, skills, languages land in the experience bank; ticked details fill only what they pick; the main CV is untouched (Profile path).
5. With no main CV, the CV step's From LinkedIn builds one and Continue works; the wizard has no new step.
6. A non-EEA member sees the one-line note and the data-file link; a refused or timed-out consent ends in a plain message, never a spinner.
7. The access token lives only in the Keychain: never in the app's logs, settings, store, Notion or an upload (test with fake tokens). It survives a restart, **Update from LinkedIn** works with it, and Disconnect, expiry and a 401 delete it.
8. 401/403/429 stop the import with a message; no retry; a 426 is reported as "LinkedIn changed its API".
9. The privacy page matches what is built (table above), with nothing about LinkedIn jobs.
10. Every new screen and action is in the ⌘K palette; light and dark preview approved by the owner before the visual commits.

## Open decisions (recommendations marked)
| # | Question | Recommendation |
|---|---|---|
| D1 | Show the button to everyone with the EU note, or hide it? | Show with note (we cannot know the country) |
| D2 | Token memory-only, or Keychain for re-import? | **Decided by the owner, 3 Nov 2026: Keychain, up to 60 days** ("memory-only … after next app restart? That's not ok") |
| D3 | No main CV: build it from LinkedIn at the CV step? | Yes, like Build with AI |
| D4 | Differing Your details: unticked by default? | Yes |
| D5 | 3 PRs, site first? | Yes |

## Progress
- [x] Docs read, existing code mapped (`linkedin-export.js`, `linkedin-oauth.js`, `experience.addLinkedin`, `cv-build.saveBuilt`, wizard `#cv-linkedin`) (proof: none: a reading step and the owner's answers, nothing in code)
- [x] Spec written (proof: docs/superpowers/specs/2026-11-03-linkedin-profile-import-design.md)
- [x] Sketch + owner's answers (3 Nov 2026): D1 show with note, D2 **Keychain (changed from my recommendation)**, D3/D4 yes, D5 go (proof: none: a reading step and the owner's answers, nothing in code)
- [ ] Client secret to Keychain + Worker secret; redirect URLs added to app 264991117
- [x] PR 1/3 site: Worker + privacy wording (jobadabra-web#336, merged); hand-off hardening (web#337, app#3033, merged) (proof: none: merged in jobadabra-web#336 and #337, app #3033)
- [x] PR 2/3 app: Profile import + What-came-in sheet (this PR) (proof: desktop/lib/linkedin-import.js)
- [ ] PR 3/3 app: CV step third way in
- [ ] Owner's real try on his own LinkedIn; fixtures re-recorded from it
