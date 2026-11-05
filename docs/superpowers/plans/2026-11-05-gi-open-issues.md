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
