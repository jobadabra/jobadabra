# E-mail consent: one switch under the CV card, on by default

Status: owner decided 5 Nov 2026 — "when a user installs the app.. at some point we popup him (or he can deliberately go to Settings -> Notifications) and set up his email.. But let's exctract it from the CV and prefill it and use it... But still, I think we shouldn't start sending him email right away. We shuold still get the user constent."; "The form filling I don't think should be a step/trigger. We just take it is in CV and we put into the form. Just as we do we with first/last name and othe details, which doesn't need to be confirmed."; pick "Line in the CV step (Recommended)"; on the redesign "A: switch row under the card (Recommended)"; then "Let it be on by default"; on the reviewer's EU note, "Keep on, service mails only (Recommended)". Short name `co`. Part 1 of 2 (app); part 2 (the site keeps the same record) is optional.

## Verdict

- 🟢 In the CV step, under the CV card: **one switch, ON by default** when the CV has an address (owner, 5 Nov 2026: "Let it be on by default"); Continue with it on is the consent, off sends nothing. Its words: "E-mail me when an application needs me or a strong match comes in. We only write when something needs you. Stop any time." No pop-up, no new step, no extra click.
- 🟢 The CV e-mail **fills forms with no confirmation** (like first/last name, already so: `lib/contact-from-cv.js`). Consent gates **only** what the product sends.
- 🟢 Turned off → asked **once more** when the person turns on Always on; never again after that.
- 🟢 The switch covers **service mails only**: mail about the person's own applications and matches (owner, 5 Nov 2026: "Keep on, service mails only (Recommended)"). Marketing needs its own separate choice that starts unticked.
- 🟢 Consent is stored with **date + the exact wording shown**. The first mail is the welcome with its stop link; nothing is held back for a click in the app.
- 🟢 Settings → Notifications shows the same choice: **one stored value, one owner** (`lib/email-consent.js`).

## What exists today (checked 5 Nov 2026)

| Piece | Today | Change |
|---|---|---|
| The address | Typed in Settings → Notifications; `notify-channel.save` sends it to the site (`PUT /api/account/email`, jobadabra-web `api/account-email.js`) | The CV's address is **offered** there too; the same `save` is the only way to the site |
| What the PUT does | creates the account, sends the **welcome mail** (confirm button, footer with the one-click stop link), pings the owner on Telegram | unchanged: it now runs only after a consent |
| The CV's address | read at upload into `cv/cv.json` `links` (a `mailto:` href, `lib/cv.js`); Your details from the CV fills `contact.email` at setup | **only read**; never sent to the site, never put in `notifyEmail` before consent |
| Consent | none stored: typing an address in Settings was the whole act | `settings.emailConsent` |
| Product news | counted as on once an account exists, unless switched off (`notifyMarketing !== false`, and the site's read) | **off until the person ticks the separate box** in Settings → Notifications (`wantsNews`); every account the app creates sends `marketing: false` unless ticked |

## States and their one owner

Owner: `desktop/lib/email-consent.js`. Nothing else writes these settings. It imports nothing heavy, because every sender imports it; reading the CV's address lives in `desktop/lib/email-from-cv.js`, which only the IPC layer imports.

| State | Stored as | Written by |
|---|---|---|
| **No e-mail** | no CV address read, `notifyEmail` empty | — (the switch does not show) |
| **E-mail, no consent** | an address read from the CV (derived, never stored as `notifyEmail`); `emailConsent` absent | the CV import / Your details |
| **Consent** | `settings.emailConsent = {at: ISO date, wording: <the exact sentence shown>, where: 'cv' \| 'alwaysOn' \| 'settings', given: 'default' (left on as it started) \| 'switched' (the person turned it on)}` and `notifyEmail`, `notifyBy` ∋ `email` | `consent()` only, after the site accepted the address |
| **Asked** | `settings.emailConsentAsked = {cv?: ISO, alwaysOn?: ISO}` | `asked(where)`; each place asks once |

Verdicts that change them:

| Verdict | From → to |
|---|---|
| Person presses Continue with the switch on (CV step), or Turn on again with it on (Always on), or switches e-mail on in Settings | no consent → consent, `given` = `default` if the switch was never moved, else `switched` (only when the site accepted the address; if not, nothing is stored and a toast says why) |
| Person turns the switch off before Continue | nothing is sent; asked.cv set |
| Person leaves the CV step with the switch off | asked.cv set; Always on will ask once, its switch on again by default |
| Person presses Turn on Always on, no consent, CV address known, Always on not asked yet | the switch row shows in the card, on; the press stops there; asked.alwaysOn set; the next press answers it and goes on |
| Person switches e-mail off in Settings (on → off; any other Settings save changes nothing) | consent withdrawn (`emailConsent: null`): never offered again, Always on gets no address; `email` leaves `notifyBy`; the app stops mailing (the site's account stays; its stop link is the site's own) |
| A person who typed an address in Settings **before this change** | counts as consented (`consented()` is true when `notifyEmail` was already set: their own typing), recorded as `where: 'settings'`, wording "Typed in Settings → Notifications before 5 Nov 2026" |

Rules the code review (5 Nov 2026) added: Settings offers the CV's address only as the placeholder (sent only when e-mail is switched on there: `addressToSave`); any new address the site accepts records a consent if none is stored (an address typed for Always on too); a consent from the switch never turns on product news (`marketing: false`); Always on's ask counts as asked when it is answered, not when shown.

`consented(storage)` is the one question every sender asks: `channelsOf` drops `email` without it, so the engine (`JOBADABRA_NOTIFY`), `sendEmail`, Always on and the waiting message all follow.

## Words (each true today)

- Switch row under the CV card, title + note: **E-mail me when an application needs me or a strong match comes in. We only write when something needs you. Stop any time.**
  - "We only write when something needs you": true today: an application waiting, a match, a reply, and the digest of those (owner, 5 Nov 2026, "Reword it (Recommended)": "At most one a day" was not true, the site sends urgent mail at once and caps at 6 a day).
  - "Stop any time": the footer of every mail carries the one-click stop link (`shared/mail.js`).
- The note starts "To <the address from the CV>." (the switch row splits the sentence: `email-consent-words.js` `WHAT` + `REST`; stored as `LINE`, both together).
- Always on re-ask: the same sentence, same wording stored.
- If the save fails in the CV step, a toast (the step is gone by then): "E-mail not turned on" · "Could not save it just now. You can turn it on in Settings → Notifications.", a click opens Notifications. At Always on, the same sentence in the card's own message line.

## Acceptance criteria

1. The switch starts on when the CV has an address; moving it sends nothing; Continue with it on stores `emailConsent` with the date, the exact sentence and `given`; off sends nothing (`renderer/email-consent-choice.js`).
2. No call to `/api/account/email` or `/api/notify/email` happens without `consented()` (test: save with an address and no consent, `sendEmail`, and `notifyEnv` do nothing).
3. The CV address still fills a form whatever the switch says (`contact-from-cv` unchanged, `details-at-setup` saves it at setup).
4. Turned off in the CV step → asked once in Always on (on by default there too); answered there → never again (test over `shouldAsk`).
5. Settings → Notifications shows the stored value (e-mail on after a consent); switching e-mail off there withdraws it.
6. The sentence promises nothing the site does not do (no count of mails in it).
7. No real address or CV text in tests, shots or the PR.

## Non-goals

- Marketing mails; the "new sign-up" Telegram alert on the Marketing channel (session `nt` builds it on `emailConsent.at`).
- Removing the site's confirm link for **unconfirmed** addresses: the owner chose "Keep the confirm link (Recommended)" on 5 Nov 2026; no site change.
- The site keeping its own copy of the consent record (part 2/2, optional).
- Switching e-mail off also deleting the site account.

## Plan

1. **1/2** `[co] 1/2 …` spec, `email-consent.js`, the gate in `notify-channel`, the switch under the CV card, the Always on ask, Settings, the narrow-card fix.
2. **2/2** (optional) jobadabra-web stores `{at, wording, given}` beside the address.

## Progress

- [x] Spec (proof: docs/superpowers/specs/2026-11-05-email-consent-design.md)
- [x] Side-by-side preview and the owner's yes on 5 Nov 2026, in the Redesign section (proof: docs/superpowers/specs/2026-11-05-email-consent-design.md)
- [x] Tests first, then `email-consent.js` and the gate (proof: desktop/test/unit/main/email-consent.test.js)
- [x] Redesign after "Too crowded": owner picked A, then "Let it be on by default" (proof: desktop/renderer/email-consent-choice.js)
- [x] The switch under the CV card, Always on ask, Settings; the narrow-card fix (proof: desktop/integration/app/setup-cards-narrow.test.js)
- [ ] Code review, ship, READY

## Redesign (5 Nov 2026, after "this looks bad UI. Too crowded.")

- **Why the first try was crowded:** it put two more small centred lines inside the hero card, between the file chip and the buttons. Every line had the same weight, so the card had no rest and the consent read as fine print.
- **Variant A (picked by the owner, then "Let it be on by default"):** the card stays as on main. The consent is Settings → Notifications' own **switch row**, under the card at its width and above Back / Continue, left-aligned. The title is the owner's first sentence; the muted note is "To <address>. We only write when something needs you. Stop any time." Stored wording = title + rest (`email-consent-words.js` `LINE`).
- **Variant B:** one compact switch line inside the card under the file chip, with a shorter sentence ("E-mail me only when something needs me, at <address>. Stop any time.").
- **Narrow windows (a bug of the CV card itself, on main):** at the narrowest window (640 px, `lib/main-window.js` MIN_WIDTH), "Build one with AI" was cut 13 px off the card. Root cause: `renderer/magic.css:72` `.cv-ways { flex-wrap: nowrap }`, inside `.magic`'s one implicit grid column (magic.css:3), which grows to its widest child's min-content. Fix: `.cv-ways` wraps; `.magic` gets `grid-template-columns: minmax(0, 1fr)`. Test of the class: `integration/app/setup-cards-narrow.test.js` (every `.magic` setup step at MIN_WIDTH, fullest state; fails on main, passes now). Why the guards missed it: `narrow-window.test.js` reads only the text `1fr`, and `uicheck` reports a clipped card as a warning only.
- A 420 px window cannot happen: the window's minimum is 640 px.

