# gi: the open GitHub issues of 5 Nov 2026

Owner, 5 Nov 2026: "start another session (opus) to process all the github issues." Each open issue gets a verdict (fixed, false, duplicate,
parked, left open with a reason) through `desktop/e2e/apply-verdict.sh`; each real bug still present on main gets one PR, `Fixes #n`.

## Progress
- [x] 1/4 A jobs.ch posting with no address keeps its page's town (#3242, #3262 merged) (proof: tests/unit/sources/test_places_strict.py @79d55d1)
- [x] 2/4 dropped: #3109 item 1 is not a bug (proof: none: the tester's log of 3 Nov 2026 shows the PC slept and the search started a minute after waking)
- [x] 3/4 A Gmail check draws one card per email (#3187, #3271 merged) (proof: tests/unit/ai/test_mail_match.py @0f2f16b)
- [x] 4/4 The Interviews recording-consent notice is two whole sentences (#3203; this PR) (proof: desktop/integration/app/screen-interviews.test.js)

Closed as already fixed on main (the PRs did not say `Fixes #n`): #3055 (#3064), #3056 (#3067), #3057 (#3070), #3060 (#3075),
#3061 (#3077), #3108 (#3154), #3025 (#3171), #3152 (#3156); #3109 item 2 (#3145).

## Follow-on work (6 Nov 2026): the employer-list data loss, the scout's memory, the search's safety
- [x] 5/N The employer list restored from D1 Time Travel, countries and kinds merged (proof: Coverage serves 5,931 named cells, 1 Nov had 5,351)
- [x] 6/N An employer keeps every AI answer when a re-read can't ask (#3310, #3317, #3324 merged) (proof: tests/unit/ai/ and the next scout run's kept countries and kinds)
- [x] 7/N A publish keeping under 90% of employers is refused; dated copies kept 30 days (web#449, #453, #454 merged) (proof: test/unit/api/employers.test.js, boundary 89 refused / 90 passes)
- [x] 8/N The scout keeps a private copy of its memory in R2 and restores it (web#457, jobadabra#3330, lab#82 merged) (proof: lab tests/test_scout_workflows.py; next scheduled scout run logs `saved to R2`)
- [x] 9/N The restart badge counts squash-merged PRs again (#3328 merged) (proof: desktop/test/guards/release/build-state.test.js, real git history)
- [x] 10/N A sign-in popup stays attached to its page (#3325 merged) (proof: desktop/integration/app/signin-popup.test.js; Google's sign-in page loads in the popup in the twin)
- [ ] 11/N Find jobs scores the nearest batch of titles as it lands (slot 1, branch gi-batch-first; owner: "Score from the nearest batches as they land (Recommended)") (proof: whole-press test and 4-city runs on main vs branch)
- [ ] 12/N The nightly Search check shows in Admin and alerts the owner (slot 2, web then public) (proof: the 6 Nov verdict rendered in Admin and the alert text)
- [ ] 13/N Search safety: why 4 of 6 personas are unmeasured, per-step counters, whole-press replay test (brief-gi-search-safety.md; owner: "Layer 2 step 0, then layer 1, then 3 (Recommended)")
- [ ] 14/N Try "Use my Chrome sign-in" in the twin (the twin's `open` shim drops chrome-extension:// URLs; the twin folder name is stale) (owner: "This flow doesn't work")
