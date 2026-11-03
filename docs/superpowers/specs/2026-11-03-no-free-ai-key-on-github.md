# No Free AI key on the user's GitHub

Owner, 3 Nov 2026: "I think only most advanced users will use the Always on on their GitHub. And if they do, they should use their own API Key. Free AI key, I think it's a security and cost risk to let it be copied and mass distribute outside the Jobadabra app." Chosen: stop copying and remove the copies already there; ask for the user's own key before the repo is set up; hosted Always-on is the no-key option.

## Root cause
`desktop/lib/github.js` `payload()` copies the app's Anthropic key slot to the repo. When it holds a Free AI key (`JPF1.<install>.<token>`, purpose `ai`) that is a live key to the install's Free AI budget, plus `JOBADABRA_AI_BASE_URL`. `JOBADABRA_TRIAL_KEY` was the same key copied again, to every Always-on repo, for the trial status.

## Design
- **States of a repo's AI:** (1) the user's own key: sent as before; (2) no key: no AI on GitHub, the checklist asks for one; never the Free AI key.
- **One owner:** `payload()` decides what goes to GitHub; a `JPF1` value is never sent (checked on the whole secret list, not per name).
- **Trial status on GitHub:** a repo key (`JPT1.<handle>.<mac>`) from the website: an opaque handle mapped to the install, minted only on proof of the install's own key. It opens `/api/trial/status` and `/api/notify/email`, no AI route. The key carries no install id (JOB-270, found by the code review of the first version).
- **Existing repos:** at app start `updateRepo` deletes a copied `ANTHROPIC_API_KEY` (when the app's slot holds a Free AI key) and `JOBADABRA_AI_BASE_URL`, and replaces `JOBADABRA_TRIAL_KEY` with the repo key (deletes it when none could be minted); once, logged.
- **Checklist:** the Always-on card asks Free AI and subscription users for their own Anthropic or OpenAI key, with one line and a button to hosted Always-on as the no-key option.

## Progress
- [ ] 1/2 jobadabra-web: the repo key (`shared/trial-key.js`, `/api/install-token` purpose `trial`)
- [ ] 2/2 app: no `JPF1` to GitHub, removal of copies, repo key, checklist
