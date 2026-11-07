# End-user notification language verification

This record covers the approved seven-language email and Telegram work. It is a delivery record, not a measurement of whole-app string coverage. The authoritative milestone checklist remains in [the design](2026-11-07-user-notification-language-design.md).

## Delivered boundaries

- The saved desktop language is authoritative; new or unsupported preferences use English. Regional/system choices resolve before delivery.
- Local Python runs, scheduled daily/mail/scout runs, email registration and delivery, Pro codes, confirmation resend, and the deployed user bot receive explicit language context.
- Account language is derived delivery metadata. Requesting a sign-in code does not change the target account's preference; authenticated refresh follows successful verification.
- Full repository syncs and language-only writes share a queue. Bot deployment requests receive separate deadlines after queue waits.
- Owner/admin/CI messages retain English context. End-user Test actions can localize; the generic test flag does not identify an owner audience.

The service foundation, all twelve email templates, transactional request context, Python digest runtime, and desktop delivery bridge have merged through private #482/#483/#484 and public #3484/#3485/#3488. Final bot recording labels and desktop completion/private-error/Gmail notices merged through #3495/#3496. The remaining Python producer PR #3499 is exact-head READY for the owner's merge.

## Verification evidence

| Boundary | Evidence |
|---|---|
| Desktop delivery and credentials | 104 combined named checks; 12 affected checks after the final startup refinement; actual sign-in/rejected-code, own-key/no-address, consent, recipient and raw-content fixtures |
| Repository/deployment ordering | Failing-first old-sync/new-language race, queued bot deployment snapshot, per-request timeout and daily/mail/scout propagation fixtures |
| Service cache and rollout | 49 named fake-account/formatter checks, including missing-column rollout and no false cache acknowledgement |
| Transactional code/resend | 38 named fake API checks, including explicit/cached/English context and no unverified account preference write |
| Email composition | All twelve templates across seven languages; HTML/text, plural, escaping, raw data and English operational context; final existing composition/locale recheck 10/10 |
| Python producer families | 169 named checks across twelve files, including real callbacks with fake services, canonical logs/records and seven-language projection |
| Final desktop completion/error copy | 74 focused callback/canonical/renderer checks and 20 workflow-path checks after reusing the existing partial-search formatter |
| Bot recording labels | 48 named checks; real filenames, fixed canonical fallback names, dispatch values and all four media shapes preserved |

The named checks use fictional data and fake transports. No real email, Telegram message, application submission, production AI call or owner-data write was used for verification. CI remains the authority for each published head.

CI exposed two existing fixture contracts that the isolated producer checks did not cover: the mail module's formatter export and a workflow-test launcher assuming a local `.venv` path. The original export was retained; the launcher now uses the running interpreter. All thirteen unchanged engine/parser assertions pass, and the workflow's seven-language, channel-gate and explicit English-fallback assertions remain intact. The budget heading also reads one authored key instead of duplicating its text inside two templates.

## Render review and limits

Email artifacts include 84 HTML/text pairs and representative screenshots. Russian release copy in a narrow dark layout and Romanian trial copy in a light layout were reviewed without visible clipping. Existing pure bot formatters produced 42 fictional examples; Python produced 98 examples across fourteen scenarios and seven languages, including an English-only operational scenario. Representative Russian/Romanian output and the scenario inventory were reviewed.

Names, actual filenames, employers, roles, codes, URLs, identifiers, dates and supplied owner/user/provider/AI content retain their values. Release month/intro/changelog prose and generated narrative or structured decisions are not automatically translated. This includes raw diagnostic reasons and generated confidence/verdict values inside translated framing. No extra AI translation service was introduced.

The website and admin UI are outside this delivery scope. Earlier desktop/extension coverage is a separate checklist; this work does not claim every desktop string or every dynamically supplied message is translated.

## Final integration

- Private service and email changes: merged.
- Shared public language delivery, digest runtime and initial desktop/bot copy: merged.
- Remaining Python notification families: #3499 READY at 7eb3113022d91b27f32cce0d47091b75b68a4ce4. The watcher emitted READY; every check and the required aggregate status passed, Gitar approved, no review threads remained open, and GitHub reported MERGEABLE/CLEAN. Owner merge remains pending.
- Final desktop completion/private-error/Gmail notices: #3496 merged at 7986d7e.
- Bot fallback names: #3495 merged at e16bcdd2e992d61563d09ed79da0d7c22d94b54e.
- Owner merges each PR. Agents do not merge.
