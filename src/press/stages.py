"""The stages of one Find jobs run as data (plan docs/superpowers/plans/2026-11-07-the-press.md 4/6; spec 2026-11-07-the-press-design.md, "The stages
today"): which stage there is, the files that own it, what it takes and leaves, the budget rows that bound it and the stages that run beside it.
A stage added or moved is a row here (the one owner of "which stage runs, in what order, beside what"); nothing reads this table to decide a run: the
code still calls its stages in daily_search.py, and tests/unit/press/test_stages.py keeps the table true (each owner file exists, each budget row is in
budget.json, runs-beside is symmetric, each clock stage of src/press/clock.py is in one row). `clock`: the names `Clock.STAGES` knows it by (the
"⏱ Time is up" lines); `app`: the key of its step in desktop/lib/press-stages.js (the steps the app starts as processes).
Beside, as the spec's table says (E2a-1 and E2a-2 made 2 and 5 side by side): the waiting jobs' scoring runs beside the employer pick, the boards first and the
employer reads; the boards beside the employer sites; places and titles beside the reads and each other; titles beside scoring."""
from typing import NamedTuple


class Stage(NamedTuple):
    id: str
    name: str
    owners: tuple   # files that own it, repo-relative
    inputs: str
    outputs: str
    budget: tuple   # rows of budget.json that bound it
    beside: tuple   # ids of the stages that run at the same time (symmetric)
    clock: tuple = ()   # Clock.STAGES names it says "Time is up" with
    app: str = ''   # the key of its step in desktop/lib/press-stages.js


TABLE = (
    Stage('boards_step', 'Job boards step (discover)', ('src/sources/boards.py', 'src/sources/board_employers.py'), 'the person\'s search',
          'job boards and their employers', ('boards.SHARE_S',), (), ('job boards', 'employer names')),   # no app key since 11 Nov 2026: the app starts no step of its own for the boards (desktop/lib/search-steps.js)
    Stage('early_reads', 'Board web search, EURES early', ('src/sources/board_web.py', 'src/sources/eures.py'), 'the search config', 'boards and EURES rows read from second 0',
          ('boards_first.WEB_WAIT', 'eures.SECONDS', 'eures.LAST_PAGE', 'eures.MOST', 'eures.KEEP'), ('employer_pick', 'first_slice'), ('web search',)),
    Stage('waiting_scored', 'Waiting jobs scored first', ('src/daily_search_scoring.py',), 'jobs found earlier and not scored', 'scores',
          ('time_budget.SHARE.job', 'time_budget.PACE.job'), ('employer_pick', 'boards_first', 'employer_sites')),
    Stage('employer_pick', 'Employer pick', ('src/employer_index.py', 'src/source_rank.py', 'src/sources/read_budget.py'), 'the employer index, places',
          'the employers to read, in order', ('read_budget.READ_FLOOR',), ('early_reads', 'waiting_scored')),
    Stage('first_slice', 'First-jobs slice (first run only)', ('src/first_jobs.py',), 'a slice of fast feeds', 'the first scored jobs',
          ('first_jobs.SLICE', 'first_jobs.FIRST_JOBS', 'first_jobs.MAX_FIRST', 'first_jobs.SLICE_BOARDS'), ('early_reads', 'boards_first')),
    Stage('boards_first', 'Boards first / boards beside', ('src/sources/boards_first.py', 'src/sources/boards_ahead.py', 'src/sources/boards_beside.py'),
          'the boards the web search found', 'job rows', ('boards_first.WEB_WAIT', 'read_budget.READ_SECONDS'),
          ('waiting_scored', 'first_slice', 'employer_sites')),
    Stage('employer_sites', 'Employer sites read', ('src/sources/feed_scan.py', 'src/sources/read_budget.py'), 'the employers to read', 'job rows and titles',
          ('read_budget.READ_SECONDS', 'read_budget.READ_FLOOR', 'read_budget.READ_GRACE'), ('waiting_scored', 'boards_first', 'places', 'titles'),
          ('employer sites', 'descriptions')),
    Stage('free_apis', 'Free APIs, Google Jobs, alert e-mails', ('src/sources/aggregators.py', 'src/sources/google_jobs.py', 'src/sources/job_alerts.py'),
          'the search config, the person\'s alert e-mails', 'job rows', ('read_budget.READ_SECONDS',), (), ('free job APIs', 'Google Jobs', 'job-alert emails')),
    Stage('places', 'Places', ('src/ai/place_triage.py',), 'job locations', 'each location placed (best, near, far)',
          ('time_budget.SHARE.place_rounds', 'time_budget.SHARE.place_vague', 'time_budget.SHARE.place_reading',
           'time_budget.PACE.place_rounds', 'time_budget.PACE.place_vague', 'time_budget.PACE.place_reading'), ('employer_sites', 'titles'), ('places',)),
    Stage('titles', 'Title sorting', ('src/ai/title_triage.py', 'src/ai/title_queue.py', 'src/sources/feed_order.py'), 'job titles, in readers', 'titles kept or dropped',
          ('time_budget.RESERVE.titles', 'time_budget.TAIL', 'time_budget.LOCAL_TITLES', 'time_budget.FEED', 'time_budget.SHARE.title_rounds',
           'time_budget.PACE.title_rounds', 'title_triage.BATCH', 'title_triage.MAX_NEW'), ('employer_sites', 'places', 'scoring'), ('title sorting',)),
    Stage('scoring', 'Scoring', ('src/ai/score.py', 'src/first_jobs.py', 'src/daily_search_scoring.py'), 'kept jobs', 'fit scores',
          ('daily_search_scoring.IN_FLIGHT', 'time_budget.RESERVE.score', 'time_budget.FLOOR', 'time_budget.SHARE.score', 'time_budget.PACE.score'), ('titles',), ('scoring',)),
    Stage('facts', 'Job facts, kits', ('src/ai/enrich.py', 'src/ai/kit.py'), 'scored jobs', 'facts and application kits',
          ('time_budget.RESERVE.enrich', 'time_budget.SHARE.enrich', 'time_budget.PACE.enrich'), (), ('job facts', 'kits')),
    Stage('scout', 'Employer finder (scout)', ('src/scout.py',), 'the person\'s search', 'new employers', ('app.SCOUT_SHARE_S', 'app.STOP_MARGIN_S'), (), (), 'scout'),
)
BY_ID = {stage.id: stage for stage in TABLE}
