"""The press's fix ledger: every past fix to Find jobs' order or clock, by name, with the tests that prove it (spec docs/superpowers/specs/2026-11-07-the-press-design.md).
Owner, 7 Nov 2026: "we overwrite one another and we never get it right" · "I want it to be a very good and bulletproof algoritm". test_ledger.py runs each fix's proofs
under the fix's name, so a change that undoes one goes red as "L13 · #3089 · jobs found earlier take scoring's time first". The ledger only grows:
- a new fix to the press adds its row here (and its proof test), then `python3 -m tests.unit.press.ledger --write-lock`;
- changing or removing a row, or the source of one of its proofs, changes ledger.lock.json, and the PR then needs the owner's words:
  a `Ledger-change: L<nn> "<owner's words>"` line in its body (tools/press-ledger-check.py, pr-gate.yml "Fix ledger kept").
A proof is `<test file>::<test method>`; one under desktop/ is `<node test file>::<text in it>`: its whole test(...) block is locked here and the desktop suite runs it."""
import ast
import hashlib
import importlib
import inspect
import json
import sys
import unittest
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LOCK = Path(__file__).with_name('ledger.lock.json')


@dataclass(frozen=True)
class Fix:
    id: str          # L<nn>, never reused
    since: str       # date and commit or PR that made it
    gets: str        # what the person gets, in their words
    proofs: tuple    # '<test file>::<test method>'
    owner: str = ''  # the owner's words behind it, when there are any
    notes: tuple = field(default=())


FIXES = (
    Fix('L01', '18 Oct 2026 bf76a0a7', 'the first 3 jobs of a search are scored whatever the clock says',
        ('tests/unit/ai/test_score_floor.py::test_scorings_spent_share_still_takes_and_starts_the_first_three',
         'tests/unit/ai/test_score_floor.py::test_the_floor_is_per_search'), owner='Yes, always 3'),
    Fix('L02', '24 Oct 2026 d45b78fa (Chisinau)', 'job titles in your own places are sorted past the clock',
        ('tests/unit/ai/test_title_triage_local.py::test_local_titles_are_sorted_after_the_clock_and_others_wait',
         'tests/unit/ai/test_title_triage_local.py::test_the_floor_is_the_searchs_first_titles_only')),
    Fix('L03', '26 Oct 2026 b5228c68, be074c43', 'every stage counts from the press, so a press ends in 3 minutes',
        ('tests/unit/sources/test_three_minutes.py::test_a_step_counts_from_the_press_not_from_its_own_start',
         'tests/unit/sources/test_three_minutes.py::test_every_stage_does_no_new_work_once_the_run_is_over',
         'tests/unit/ai/test_search_budget.py::test_the_crawl_and_the_ai_steps_share_one_deadline',
         'desktop/test/unit/main/search-steps.test.js::assert.equal(seen[0].stopAfterMs, 175000'),
        owner='A find jobs session should take at most 3min'),
    Fix('L04', '26 Oct 2026 55675c38 (a run ended at 188 s)', 'no AI call starts in the last seconds of the press',
        ('tests/unit/sources/test_three_minutes.py::test_no_floor_starts_an_ai_call_in_the_runs_last_seconds',
         'tests/unit/ai/test_score_floor.py::test_the_floor_never_passes_the_runs_end')),
    Fix('L05', '26 Oct 2026 b5228c68 (the 06:21 press, 269 s)', 'the job boards step ends at its share of the press',
        ('tests/unit/sources/test_three_minutes.py::test_slow_boards_end_at_discovers_share_and_wait_for_the_next_search',
         'tests/unit/sources/test_three_minutes.py::test_past_its_share_the_fixed_boards_read_nothing_and_follow_no_employer')),
    Fix('L06', '26 Oct 2026 be074c43 (1,123 sites for 5 minutes)', 'the best employer sites are always read, the rest are kept and read first next time',
        ('tests/unit/sources/test_read_budget.py::test_a_1123_site_list_with_a_slow_tail_ends_in_its_time_best_first_and_keeps_the_rest',
         'tests/unit/sources/test_read_budget.py::test_the_next_run_reads_the_best_then_what_was_left_then_the_rest',
         'tests/unit/sources/test_read_cut.py::test_every_reader_leaves_a_hanging_site_at_the_cut'),
        owner="it shouldn't just go brute force and check all the employers, it should be smart"),
    Fix('L07', '10 Oct 2026 (0 of 103 facts read)', 'a press that scores first still keeps time to read the jobs\' facts',
        ('tests/unit/ai/test_search_budget.py::test_a_refresh_that_scores_first_leaves_the_facts_their_time',
         'tests/unit/engine/test_score_first_from_start.py::test_a_timed_search_with_a_profile_scores_first_from_the_start')),
    Fix('L08', '27 Oct 2026 (benchmark 40504636029)', 'EURES is read from the first second of the press',
        ('tests/unit/sources/test_eures.py::test_the_search_starts_it_with_the_run',
         'tests/unit/sources/test_eures.py::test_the_stage_takes_the_read_started_with_the_search_and_asks_nothing_itself')),
    Fix('L09', '#2913 (2 Nov 2026)', 'the first press asks for its job boards once the employers are named, not in front of them',
        ('tests/unit/ai/test_first_press_boards_early.py::test_the_search_starts_it_once_the_employers_are_named_not_inside_the_slice',
         'tests/unit/ai/test_first_press_boards_early.py::test_the_slice_asks_the_ai_nothing_twice_and_keeps_the_shared_boards')),
    Fix('L10', '26 Oct 2026 b314e715, then #2928 (2 Nov 2026)', 'a press reads the job boards first; a first press reads its slice first and scores employer jobs without waiting for the boards',
        ('tests/unit/sources/test_boards_first.py::test_the_found_boards_come_before_the_first_jobs_slice_and_the_employer_sites',
         'tests/unit/sources/test_first_press_order.py::test_a_first_press_reads_its_slice_then_the_known_and_web_searchs_boards',
         'tests/unit/sources/test_first_jobs_slow_boards.py::test_the_employer_jobs_are_scored_before_a_slow_boards_step_ends'),
        owner='START A JOB SEARCH WITH SEARCHING ON GOOGLE!'),
    Fix('L11', '#2064 (26 Oct 2026)', 'no AI round is forced per board, so scoring starts early',
        ('tests/unit/sources/test_three_minutes.py::test_a_round_its_share_does_not_cover_is_not_asked',)),
    Fix('L12', '#3058 (3 Nov 2026)', 'calls that failed do not shrink the next batch',
        ('tests/unit/ai/test_step_pace_failures.py::test_scoring_paces_the_calls_that_worked',
         'tests/unit/ai/test_step_pace_failures.py::test_the_lost_share_is_taken_off_the_batch_seconds')),
    Fix('L13', '#3074 then #3089 (3 Nov 2026, the end state)', 'jobs found earlier and never scored take scoring\'s time first',
        ('tests/unit/ai/test_daily_search_phases.py::test_a_refresh_scores_the_jobs_waiting_before_it_searches_for_new_ones',
         'tests/unit/ai/test_daily_search_phases.py::test_the_waiting_pass_takes_all_of_scorings_time',
         'tests/unit/ai/test_daily_search_phases.py::test_a_search_that_uses_the_whole_clock_still_leaves_the_waiting_jobs_scored')),
    Fix('L14', '#2918 (5 Nov 2026, Toulouse vs Paris)', 'among jobs in your places, the ones nearest your best place come first',
        ('tests/unit/sources/test_job_rank.py::test_best_places_first_then_the_closest_then_the_order_kept',
         'tests/unit/press/test_ledger_scenarios.py::test_l14_the_job_nearest_your_best_place_comes_first'), owner='One clear order first'),
    Fix('L15', '#3305 (5 Nov 2026)', 'EURES reads the regions near you first, the country last',
        ('tests/unit/sources/test_eures.py::test_it_asks_the_persons_regions_nearest_first_and_the_country_last',
         'tests/unit/sources/test_eures.py::test_each_word_gets_its_first_page_before_any_word_gets_a_second',
         'tests/unit/sources/test_eures.py::test_a_person_in_toulouse_gets_jobs_of_their_region_whatever_code_the_ai_remembers')),
    Fix('L16', '#3311 (5 Nov 2026, #2918 Copenhagen)', 'one job waiting for a score does not hold back the titles of your places',
        ('tests/unit/sources/test_first_press_order.py::test_one_waiting_job_does_not_hold_back_the_local_titles',
         'tests/unit/ai/test_title_triage_local.py::test_in_scorings_share_one_waiting_job_leaves_the_local_titles_their_turn')),
    Fix('L17', '#3336 (6 Nov 2026)', 'the nearest batch of titles, from any reader, is asked next and its jobs are scored as it lands',
        ('tests/unit/ai/test_title_queue.py::test_the_nearest_batch_is_asked_first_whichever_reader_it_came_from',
         'tests/unit/sources/test_first_jobs_hub.py::test_a_job_of_the_first_landed_batch_is_scored_before_the_readers_sort_ends',
         'tests/unit/sources/test_first_jobs_hub.py::test_another_readers_nearest_batch_is_scored_before_the_employer_sort_ends'),
        owner='Score from the nearest batches as they land'),
    Fix('L18', '#3354 (7 Nov 2026)', 'EU portal jobs reach title sorting and scoring while there is time',
        ('tests/unit/sources/test_eures_titles_in_time.py::test_a_title_the_ai_placed_inside_your_places_is_sorted_after_the_titles_clock',
         'tests/unit/sources/test_eures_titles_in_time.py::test_eures_jobs_reach_the_hub_before_their_locations_are_placed',
         'tests/unit/sources/test_first_jobs_hub.py::test_a_reader_that_has_read_is_sorted_before_the_next_score_starts')),
    Fix('L19', '#3422 (7 Nov 2026)', 'waiting title batches move up once their places are learned',
        ('tests/unit/ai/test_title_queue.py::test_waiting_reader_moves_ahead_when_its_location_becomes_known',
         'tests/unit/ai/test_title_queue.py::test_unchanged_geography_is_read_once_and_a_store_update_refreshes_priority')),
    Fix('L20', '#3482 (7 Nov 2026)', 'readers whose distance is unknown take turns, none takes every call',
        ('tests/unit/ai/test_title_queue.py::test_readers_whose_distance_is_unknown_take_turns_instead_of_the_first_taking_every_call',)),
    Fix('L21', '#3512 (7 Nov 2026)', 'a slow place call does not hold the EURES titles',
        ('tests/unit/ai/test_titles_with_places.py::test_the_other_reader_is_served_while_the_place_call_is_held_and_the_late_answer_is_applied_before_the_reader_sorts_its_titles',)),
    Fix('L22', '#3520 (7 Nov 2026, p5 Krakow)', 'a city written with accents stays in the places a search reads',
        ('tests/unit/sources/test_eures_place_fragments.py::test_a_letter_choice_is_the_spellings_it_names_and_a_real_regex_is_none',
         'tests/unit/sources/test_eures_place_fragments.py::test_eures_asks_the_cities_region_first_not_only_the_country',
         'tests/unit/sources/test_eures_place_fragments.py::test_each_reader_gets_the_plain_words_not_nothing')),
    Fix('L23', '#2920 (7 Nov 2026, p7 Dublin)', 'a round of title calls that fits before the stop is taken',
        ('tests/unit/ai/test_title_one_pass.py::test_a_round_that_fits_the_stop_starts_whatever_the_speed',
         'tests/unit/ai/test_title_one_pass.py::test_a_round_that_fits_before_the_stop_is_never_refused_by_the_share')),
    Fix('L24', '#3550 (7 Nov 2026, p7 Dublin)', 'a reader\'s titles are sorted in one pass, your places first',
        ('tests/unit/ai/test_title_one_pass.py::test_p7_the_local_titles_and_the_others_are_sorted_in_the_same_round',
         'tests/unit/ai/test_title_one_pass.py::test_calls_twice_as_slow_sort_the_local_titles_and_say_the_rest_wait')),
    Fix('L25', '#3551 (7 Nov 2026, p6 Zagreb)', 'employers seen hiring in your places are read first',
        ('tests/unit/sources/test_index_place_rank.py::test_feeds_with_place_information_come_first_and_none_is_dropped',
         'tests/unit/sources/test_index_place_rank.py::test_the_first_reads_are_the_feeds_that_name_the_place',
         'tests/unit/sources/test_index_place_rank.py::test_fast_kinds_still_come_first_and_the_place_order_holds_inside_each_group')),
    Fix('L26', '#3310 (5 Nov 2026)', 'employers stay readable through an AI outage or a lost cache',
        ('tests/unit/engine/test_scout_carry.py::test_titles_kept_but_places_lost_keeps_the_counts_through_the_real_decide_and_geo',
         'tests/unit/engine/test_scout_carry.py::test_a_lost_cache_keeps_the_mix_the_published_index_had')),
    Fix('L27', '#3170 (4 Nov 2026)', 'a source whose AI step is refused fails alone, the press goes on',
        ('tests/unit/sources/test_aggregators.py::test_a_source_whose_ai_step_is_refused_fails_alone_and_the_run_goes_on',
         'tests/unit/sources/test_aggregators.py::test_a_source_whose_answer_was_cut_short_fails_alone')),
    Fix('L28', '#3108 (4 Nov 2026)', 'a press ended by time says Partial, never "Completed"',
        ('desktop/test/unit/main/search-steps.test.js::the search step hit the limit',)),
    Fix('L29', '#3306 (5 Nov 2026)', 'big job boards are read whole and their open jobs stay open',
        ('tests/unit/sources/test_unread_systems.py::test_a_board_over_the_default_page_is_read_whole',
         'tests/unit/sources/test_unread_systems.py::test_a_job_a_partial_reader_did_not_see_is_unknown_not_closed')),
    Fix('L30', '#3517 (7 Nov 2026)', 'the job boards are asked for together, not one after another',
        ('tests/unit/ai/test_boards_asked_together.py::test_the_field_call_and_the_slices_are_in_flight_at_once',
         'tests/unit/ai/test_boards_asked_together.py::test_the_same_answers_make_the_same_list_whatever_arrives_first')),
    Fix('L31', '26 Oct 2026 757e3697', 'the AI\'s judgment of a title wins over role and excluded words',
        ('tests/unit/sources/test_titles_ai_first.py::test_the_ais_answer_wins_over_every_word',
         'tests/unit/sources/test_titles_ai_first.py::test_a_failed_or_capped_ai_sort_leaves_a_title_unknown_never_a_words_guess')),
    Fix('L32', '27 Oct 2026 d545a217', 'a title gets a second look before a role-word hit leaves the list',
        ('tests/unit/ai/test_title_one_pass.py::test_the_second_look_is_asked_for_a_role_word_no_on_the_one_pass',)),
    Fix('L33', '18 Oct 2026 801ed53d (Cluj)', 'the first press keeps scoring until a 70+ job, up to 10',
        ('tests/unit/sources/test_first_jobs.py::test_scoring_goes_on_three_at_a_time_until_a_job_fits_70',
         'tests/unit/sources/test_first_jobs.py::test_the_slice_scores_at_most_ten_while_none_fits')),
)


def resolve(proof):
    """'<file>::<method>' -> the unittest TestCase method it names (None for a node proof)."""
    path, name = proof.split('::', 1)
    if path.startswith('desktop/'):
        return None
    module = importlib.import_module(path[:-3].replace('/', '.'))
    owners = [cls for cls in vars(module).values() if inspect.isclass(cls) and issubclass(cls, unittest.TestCase) and name in vars(cls)]
    if len(owners) != 1:
        raise LookupError(f'{proof}: {len(owners)} test classes define it, expected 1')
    return owners[0], name


def source(proof):
    """The text a proof stands on, so weakening it changes the lock. Python: its module minus the other tests' bodies (constants, fixtures, helpers,
    every setUp and base class stay in), plus the source of anything it imports from another test module. Node: the whole test(...) block holding the
    text (the desktop suite runs it).
    Why (Gitar on #3561): the method and its setUp alone let `SLACK = 0.6` or a fixture's coordinates change without the owner's yes, and a node proof
    locked only as its own words let its assertion be inverted."""
    path, name = proof.split('::', 1)
    if resolve(proof) is None:
        lines = (ROOT / path).read_text().splitlines()
        at = next((n for n, line in enumerate(lines) if name in line), None)
        if at is None:
            raise LookupError(f'{proof}: no such test or assertion text in {path}')
        first = next((n for n in range(at, -1, -1) if lines[n].startswith('test(')), 0)
        last = next((n for n in range(at + 1, len(lines)) if lines[n].startswith('test(')), len(lines))
        return '\n'.join(lines[first:last])
    text = (ROOT / path).read_text()
    parts = []
    for node in ast.parse(text).body:
        if isinstance(node, ast.ClassDef):
            parts.append(text.splitlines()[node.lineno - 1])
            parts += [ast.get_source_segment(text, item) for item in node.body
                      if not (isinstance(item, ast.FunctionDef) and item.name.startswith('test') and item.name != name)]
        else:
            parts.append(ast.get_source_segment(text, node))
            if isinstance(node, ast.ImportFrom) and (node.module or '').startswith('tests.') and node.module != 'tests.unit.press.ledger':
                module = importlib.import_module(node.module)
                parts += [inspect.getsource(getattr(module, alias.name)) for alias in node.names
                          if inspect.isfunction(getattr(module, alias.name, None)) or inspect.isclass(getattr(module, alias.name, None))]
    return '\n'.join(part or '' for part in parts)


def fingerprint(fix):
    """One hash of what a fix promises and how it is proven: its words and every proof's source."""
    text = json.dumps([fix.id, fix.since, fix.gets, fix.owner, list(fix.proofs)], ensure_ascii=False)
    for proof in fix.proofs:
        text += '\n' + source(proof)
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def lock():
    """{fix id: its words and fingerprint}: what ledger.lock.json holds."""
    return {fix.id: {'gets': fix.gets, 'hash': fingerprint(fix)} for fix in FIXES}


if __name__ == '__main__':
    if '--write-lock' in sys.argv:
        LOCK.write_text(json.dumps(lock(), indent=1, ensure_ascii=False) + '\n')
        print(f'wrote {LOCK.relative_to(ROOT)}: {len(FIXES)} fixes')
    else:
        print(json.dumps(lock(), indent=1, ensure_ascii=False))
