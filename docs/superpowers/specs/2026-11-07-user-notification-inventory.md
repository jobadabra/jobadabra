# End-user notification coverage inventory

Audited7Nov2026 for the approved notification-language design. Classify audience at actual delivery callers, not names such as owner or the fact GitHub runs a job. This inventory names product-authored copy families; arbitrary content inside them is preserved.

## End-user email
The twelve template IDs are message, welcome, confirm-resend, feedback-update, account-code, digest, trial-left, trial-ending, always-on-paused, always-on-test, pro-launch and release. Scope includes fixed subjects/titles, HTML/plain-text wrappers, buttons, shared frame/footer, typed footer defaults, measured-credit explanations and release section labels. The message template carries app-matches, app-needs-you, app-applied, app-weekly, app-stopped and app-nothing row IDs unchanged.

Two additional authored producer seams sit outside the template registry: the multi-item held-digest subject, and reporter-reply fallback/thank-you sentences. They require explicit recipient locale before their supplied message reaches the template. Single supplied subjects and owner-written reporter replies stay raw, even if their wording equals a default sentence. Admin editor defaults and in-app canonical reply data keep their existing English contract.

## Python end-user producers
| Public producer family | Fixed presentation | Preserve |
|---|---|---|
| digest.py / daily_search_reporting.py | Digest headings, groups, typed badges, counts, paging, buttons | Job/company/AI facts, ranking, eligibility, callback IDs and canonical build output |
| daily_modes.py and command/interview helpers | Command acknowledgements and authored next-step framing | Commands, store/run records, generated documents and source data |
| focus.py | Reminder card framing | Task facts, IDs, action ownership and dates |
| ai/mail.py and mail/calendar helpers | Mail/calendar check and matching wrappers | Employer content, AI classifications, saved kinds/stages and raw subjects |
| ai/insights.py, ai/insights_text.py, ai/rejection.py, scout.py | Insight/weekly/rejection/employer-search framing | Generated narrative, evidence, decisions and employer data |
| trial.py, ai/budget.py and install-user doctor alerts | Typed credit/health/recovery framing | Entitlement/budget decisions and CLI/operator diagnostics |
| notify.py and installed daily/mail failure steps | User-account app-stopped alert and mail batching connector | Workflow flags, row IDs, schedules, channel selection, limits and canonical logs |

Python delivery accepts an explicit producer projection. MESSAGES, canonical str/JSON forms and activity markers remain unchanged; unprojected operational sends stay English. No repeated store/AI reads are needed for another presentation.

## Desktop and user bot
waiting-message.js, few-jobs.js and typed app-notify callers own application-waiting/few-jobs framing. telegram.js and app-core own end-user pairing, HELP, buttons, command replies and typed list formatting. always-on-test-checks.js is an end-user Test button despite its name. All keep raw personal/job/provider text and command/callback/action IDs. The desktop variable OWNER_CHAT_ID is populated from the user's saved private chat, not the team's operational chat.

The same resolved language travels to local engine runs, the user's scheduled repository and deployed user-bot bindings. New language caches are derived metadata; the existing desktop appearance preference remains authoritative.

## English-only exclusions and dynamic content
Team/owner build/release/Sentry/Brain/switchboard/CI alerts remain English. Public examples include tools/release_guard.py and CI_ALERTS/BUILDLOG callers. Admin previews and owner test sends keep English; test=true alone cannot identify that audience because it also marks an end-user Test action.

Names, roles, employers, URLs, paths, codes and provider/user/AI-authored prose are content. Supplied release month, introduction and changelog prose remain as supplied; only authored labels/templates localize. No automatic AI translation, new paid calls, website-page localization or rewriting of finished HTML/log text is introduced.
