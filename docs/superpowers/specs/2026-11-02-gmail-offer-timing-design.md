# Offer Gmail at the right moment

> **Verdict:** nothing is asked on day one. The app offers Gmail (1) in a dialog right after the person's first successful Submit, (2) in a dialog on the first job whose page asks for a code mailed to the person, and (3) as a Suggestions card (Jobs bar and Focus) until Gmail is connected. Connected → no offer anywhere.
> **Status:** owner said "Let's implement it now" (2 Nov 2026, session `gm`).

## Owner's words (2 Nov 2026)
- "At what point after the user installed the app and starts using it, I should ask/propose to connect his gmail? After the first successful apply?" → yes, after the first successful Submit.
- "It should be of the suggestions card (in Jobs and/or Focus), but also this popup/dialog should appear after first submit."
- "On the full automation... so on the first job that needs a confirmation code, we ask for the email again if it's still not set... we ask with a dialog/popup".

## Where Gmail is offered today (found by `git grep -i gmail`)
| Place | Kind | Day one? |
|---|---|---|
| Settings → Connections → Gmail and Calendar (`#google-connect`) | the one connect flow (warning dialog → sign-in) | no, a setting |
| Recent activity "Connect Gmail" after a mail check that read nothing; job drawer Messages tab | after use | no |
| Setup wizard (`pages/wizard.js`, `onboarding.js`) | none | **no day-one offer exists, nothing to remove** |

## Behaviour (states and their one owner)
| What | Owner of the state | Verdict that changes it |
|---|---|---|
| Is Gmail connected | the Keychain (`googleSecrets`, main) / `googleStatus` (window) | a finished sign-in / Disconnect |
| After-Submit asks so far (`gmailOffer.asked`, 0..2) | app settings, `lib/gmail-offer.js` (only writer) | the dialog is signalled to the window |

1. **After the first Submit.** `markApplied` (`lib/server-env.js`, the one verdict every Apply mode passes: "the page after Submit is read, the job becomes Applied") calls `gmailOffer.afterApply`. Not connected and `asked < 2` → `asked + 1` and the window opens the dialog: "Your confirmation from <employer> will land in Gmail. Connect it, and Jobadabra moves this job to Interview or Rejected when they reply." Buttons: **Connect Gmail** (clicks the existing `#google-connect`, so one flow) and **Not now**. Two asks in total (first apply, then one later apply), then never again by itself. Pressing Connect counts as an ask too.
2. **Page asks for a code.** The extension's AI judge answers `needs_code` and posts `/extension/account-code` (`extension/account-step.js`; no keyword list). The handler (`lib/ext-server-handlers.js`) **in Full automation** (owner: "On the full automation… on the first job that needs a confirmation code, we ask for the email again"; only there does a connected Gmail type the code, Gitar #3007): Gmail not connected → (a) the job is parked with the existing `terminals.noteStuck(session, 'account', host, 'the code from your e-mail: connect Gmail')` (the same "needs you" state and `accountNeeds` line every waiting job has; other jobs in the queue run on, each job has its own tab), (b) the window opens the dialog "Connect Gmail and I'll type the code for you" (the lead says this job waits for the person and the next ones get typed: connecting does not re-request a parked job's code). Not limited by the after-Submit count. At most once per app run (a second job in the same run only has the parked reason), so a queue of 20 sign-ups does not stack 20 dialogs.
3. **Suggestions card.** `renderer/gmail-offer-words.js` `gmailEntries`: kind `gmail`, topic `applying` (so Jobs bar and Focus), one button **Connect Gmail**, always there while Gmail is not connected (owner, 2 Nov 2026: "It should still be always present as in the Suggestions card… but we should show dialog/popups in moments it makes sense"), so it has no Not now (the shared one hides an entry for 14 days). The dialog's Not now only closes the dialog.
4. **⌘K.** "Connect Gmail" (only while not connected) runs the same connect flow.
5. Not in the wizard. Connected → `afterApply` returns nothing, the code branch returns nothing, the card is empty, the ⌘K entry is absent.

## Parked
- Offering after "I submitted it" by hand (`focus-handlers.js`) or the "did you submit?" dialog: the person said it, no Submit seen; rare.
- Persisted cap on the code dialog across app runs.
- Re-requesting the code for the job parked while Gmail was missing, once Gmail connects (needs the extension to ask again).

## Progress
- [x] Spec (proof: docs/superpowers/specs/2026-11-02-gmail-offer-timing-design.md)
- [x] Tests, 9 cases (proof: desktop/test/gmail-offer.test.js)
- [x] `lib/gmail-offer.js`, `markApplied` + account-code hooks, preload `onGmailOffer` (proof: desktop/lib/gmail-offer.js)
- [x] Renderer: words, dialog, Suggestions entry (Focus + Jobs), ⌘K, connected view (proof: desktop/renderer/pages/gmail-offer.js)
- [x] Preview, light + dark, and the owner's yes on 2 Nov 2026 (proof: none: the owner's answer to the AskUserQuestion in session gm; the image is in the PR body)
- [ ] PR `[gm] The app offers Gmail after the first apply, or when an apply needs an e-mail code`
