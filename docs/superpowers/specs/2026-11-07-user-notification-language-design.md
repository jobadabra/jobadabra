# End-user email and Telegram localization

Owner request, 7 Nov 2026: proceed with translating user email/Telegram notifications and all email templates. Explicit boundary: owner/admin/CI notifications stay English; only end-user-facing messages localize.

## Outcome and language policy
Use the same seven desktop languages: English, German, French, Italian, Spanish, Romanian and Russian. End-user delivery follows the resolved desktop display language; resolve `system` on the desktop, never on a server. Unknown or unsupported preference falls back to English. No extra language setting or wizard step is introduced.

The desktop preference already exists. Carry its resolved value into end-user notification producers and the delivery service's existing account/preferences boundary so scheduled mail can use it while the app is off. The service support must land before the desktop starts sending new metadata. Reuse existing identity and consent; do not add a second user-profile store. The desktop display-language preference is authoritative; the service value and scheduled-run environment are derived, refreshable delivery caches, never a separately editable preference. Refresh them on an explicit language change, launch (including a fresh OS resolution of system), successful account/email registration and normal notification preparation. A failed refresh never changes the saved desktop choice or claims remote success: retain the last acknowledged remote value, record a canonical non-secret failure and retry at the next normal refresh opportunity. Explicit current-language delivery context applies to that message; off-app sends use the last acknowledged cache, or English when none exists. No background loop or second profile store is added.

## Audience boundary
Audience comes from the actual recipient and purpose, not whether a workflow triggered it. A failed Always on run sent to that install's user is end-user copy. Build/release health sent to maintainers is operational copy and stays English. Shared template rendering defaults to English; only a proven end-user call path supplies a supported locale. Admin previews, owner test sends and CI fixtures stay English unless an explicitly isolated localization fixture requests another language. No change to admin UI language.

## Template coverage
All twelve current end-user email templates are in scope: message, welcome, confirm-resend, feedback-update, account-code, digest, trial-left, trial-ending, always-on-paused, always-on-test, pro-launch and release. Also cover their shared frame, subject, title, text/HTML body, button/link labels, footer, plural/count forms and accessibility language metadata. The six app notification rows carried by message remain governed by their existing row IDs and recipient choices.

Python/desktop user Telegram notifications cover job digests, authored search/activity/reminder/weekly/mail summaries, waiting/application notifications, test messages and user bot help/replies. Exact producer inventory accompanies the implementation plan; an audited exclusion is required for each operational caller.

## Content and invariants
Translate bundled product-authored templates, not arbitrary payload text. Preserve names, employers, roles, URLs, paths, codes, callback IDs, identifiers and user/provider/AI-authored text. Release introductions/change prose and personal generated summaries are content rather than fixed templates: preserve supplied text and localized variants; English fallback must be explicit when a variant is absent. Do not silently claim a language's template coverage proves all dynamic content translated.

Use named interpolation and real plural categories. Select the trusted locale/template before inserting values. Never replace words across finished HTML, log output or user data. HTML escaping and Telegram-safe markup remain intact.

Canonical diagnostics, activity markers and stored message identities must not become localized control inputs. Separate their canonical and user-facing forms where a producer feeds both. Preserve recipients, channel selection, schedules, batching, retry/time limits, opt-in/consent, unsubscribe links/headers, rate limits, authentication, token/code behavior, transport enums and safety boundaries. No real email/Telegram send during verification and no new AI translation calls or spending.

## Work split
Coordinator owns language selection/transport/persistence, audience enforcement and shared integration. Existing visible Sol-low panes handle bounded producer/template families in isolated worktrees; they own their tests, PR review, conflicts and exact-head readiness. Private service changes land first, then public callers. Each PR remains independently reviewable and owner-merged.

## Verification
Use fake transports/accounts only. Test all seven languages, missing/invalid preference, regional/system resolution, counts (including Russian/Romanian), HTML/text parity, escaping, raw-value preservation and delivery payload/recipient invariants. Add explicit negative tests proving owner/admin/CI subjects/bodies stay English even if a user locale is present elsewhere. Render representative fictional HTML emails and capture Telegram examples before claiming completion. No local full suites or live sends.

## PRs
1/7 Spec, approved language contract and audience inventory (this PR).
2/7 Service language cache, pure formatting and English-default audience integration.
3/7 All twelve email templates, frame/footer and release rendering.
4/7 Desktop and scheduled engine language propagation/cache refresh.
5/7 Python notification locale runtime and job-digest delivery projection.
6/7 Remaining Python end-user notification producers.
7/7 Desktop user notifications and bot replies, final coverage verification/report.

The service PRs land before the public bridge starts sending new metadata. Template workers may adopt the small shared formatting foundation without waiting for a merge, but each PR is independently checked. No private implementation file is copied into this public repo.

## Progress
### 1. Scope and inventory
- [ ] Record complete producer/template/audience inventory and exclusions.
- [x] Confirm preference and fallback contract with owner. (proof: none: owner explicitly approved this design on 7 Nov 2026)
### 2. Shared language delivery
- [ ] Service accepts/stores/resolves end-user preference with English-default operational rendering.
- [ ] Desktop and scheduled engine propagate resolved preference without changing consent or recipients.
### 3. End-user content
- [ ] All twelve email templates and shared frame/footer localize.
- [ ] Python notification templates localize with canonical diagnostics preserved.
- [ ] Desktop notification and bot help/reply templates localize.
### 4. Verification and handoff
- [ ] Seven-language content/plural/escape tests and operational-English negative cases pass.
- [ ] Fictional email/Telegram render inventory reviewed; remaining dynamic-content fallbacks disclosed.
- [ ] All scoped PRs exact-head READY and progress report updated.
