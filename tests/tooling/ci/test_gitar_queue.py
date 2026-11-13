"""Guard: release — sessions that post to Gitar on their own lock every PR out of the review READY needs (13 Nov 2026, gq: 22 asks in 70 min from every session drew 11 "wait about N minutes" refusals).
tools/gitar-queue.mjs is the one poster: one comment at a time, a PR Gitar refused waits, a replied-to thread counts, a merged PR leaves. A fake gh (files, no network) stands in for GitHub."""
import json
import os
import subprocess
import tempfile
import textwrap
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FAKE_GH = textwrap.dedent('''\
    #!/usr/bin/env python3
    import json, os, sys, time
    from datetime import datetime, timezone
    d = os.environ['FAKE_DIR']; a = sys.argv[1:]
    if os.path.exists(d + '/gh_out'): sys.exit(1)   # GitHub's REST quota is out: gh prints nothing and fails (13 Nov 2026, #4031 live)
    open(d + '/calls', 'a').write(' '.join(a[:4]) + '\\n')
    def comments(pr):
        try: return json.load(open(f'{d}/comments_{pr}.json'))
        except OSError: return []
    def flag(name, pr, default=''): return open(f'{d}/{name}_{pr}').read().strip() if os.path.exists(f'{d}/{name}_{pr}') else default
    if a[:2] == ['pr', 'view']:   # state_N: MERGED..; draft_N: exists = draft; title_N; checks_N: red | pending (default green)
        rollup_other = [{'name': 'Unit', 'conclusion': 'SUCCESS'}]
        gate = {'red': {'name': 'All checks passed', 'conclusion': 'FAILURE'}, 'pending': {'name': 'All checks passed', 'status': 'IN_PROGRESS', 'conclusion': ''}}.get(flag('checks', a[2]), {'name': 'All checks passed', 'conclusion': 'SUCCESS'})
        print(json.dumps({'state': flag('state', a[2], 'OPEN'), 'headRefOid': 'h' + a[2], 'isDraft': os.path.exists(f'{d}/draft_{a[2]}'), 'title': flag('title', a[2], '[t] A change'), 'statusCheckRollup': ([] if flag('checks', a[2]) == 'none' else rollup_other if flag('checks', a[2]) == 'nogate' else [gate])}))
    elif a[:2] == ['api', 'graphql'] and os.path.exists(f'{d}/graphql_down'):   # quota 0 / 5xx: gh prints nothing
        pass
    elif a[:2] == ['api', 'graphql']:   # every open PR's comments, from the comments_N.json files (a PR the queue never saw has one too)
        nodes = []
        for name in sorted(os.listdir(d)):
            if name.startswith('comments_'):
                rows = json.load(open(f'{d}/{name}'))
                nodes.append({'number': int(name[9:-5]), 'comments': {'nodes': [{'author': {'login': r['user']['login']}, 'createdAt': r['created_at'], 'body': r['body']} for r in rows]}, 'reviewThreads': {'nodes': []}})
        print(json.dumps({'data': {'search': {'nodes': nodes}}}))
    elif a[:2] == ['pr', 'comment']:   # Gitar answers
        if os.path.exists(f'{d}/down_after_post_{a[2]}'): open(f'{d}/graphql_down', 'w').write('')   # the post used the quota: the next read fails a PR that is under its limit with a refusal, 3 s later in real life, at once here
        if os.path.exists(f'{d}/side_refuse_{a[2]}'):   # another session's ask on the PR named in the file is refused while this post settles
            other = open(f'{d}/side_refuse_{a[2]}').read().strip(); rows = comments(other)
            rows.append({'user': {'login': 'gitar-bot[bot]'}, 'created_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),  # clock: relative the refusal is read against the queue's own reading
                'body': "You've sent several Gitar comments in a short window. Please wait about 10 minutes and comment again."})
            json.dump(rows, open(f'{d}/comments_{other}.json', 'w'))
        if os.path.exists(f'{d}/refuse_{a[2]}'):
            rows = comments(a[2]); rows.append({'user': {'login': 'gitar-bot[bot]'}, 'created_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),  # clock: relative the refusal is read against the queue's own reading seconds later
                'body': "You've sent several Gitar comments in a short window. Please wait about 10 minutes and comment again."})
            json.dump(rows, open(f'{d}/comments_{a[2]}.json', 'w'))
        open(d + '/posted', 'a').write('ask ' + a[2] + '\\n')
    elif a[0] == 'api' and '-X' in a:
        if a[2] == 'DELETE':
            open(d + '/posted', 'a').write('delete ' + a[3].split('/')[-1] + '\\n')
        else:
            pr = a[3].split('/')[4]
            if os.path.exists(f'{d}/refuse_{pr}'):   # Gitar refuses the reply too
                rows = comments(pr); rows.append({'user': {'login': 'gitar-bot[bot]'}, 'created_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),  # clock: relative the refusal is read against the queue's own reading
                    'body': "You've sent several Gitar comments in a short window. Please wait about 10 minutes and comment again."})
                json.dump(rows, open(f'{d}/comments_{pr}.json', 'w'))
            open(d + '/posted', 'a').write('reply ' + a[3].split('/')[6] + '\\n')
            print(json.dumps({'id': 9000 + int(a[3].split('/')[6])}))
    elif a[0] == 'api':
        pr = a[1].split('/')[4]
        print(json.dumps(comments(pr) if '/issues/' in a[1] else []))
    ''')


class GitarQueueTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(subprocess.run, ['rm', '-rf', str(self.tmp)])
        gh = self.tmp / 'gh'
        gh.write_text(FAKE_GH)
        gh.chmod(0o755)
        self.env = {**os.environ, 'FAKE_DIR': str(self.tmp), 'GITAR_QUEUE_DIR': str(self.tmp / 'q'), 'GITAR_QUEUE_GH': str(gh), 'GITAR_QUEUE_SETTLE_MS': '0', 'GITAR_QUEUE_GAP_S': '3600'}

    def run_queue(self, *args, now_plus=0, wait=True, **env):
        e = {**self.env, 'GITAR_QUEUE_NOW': str(int(time.time() * 1000) + now_plus * 1000), **env}   # clock: relative the queue compares only readings of this same clock
        p = subprocess.Popen(['node', str(ROOT / 'tools' / 'gitar-queue.mjs'), *args], env=e, stdout=subprocess.PIPE, text=True)
        return p.communicate()[0].strip() if wait else p

    def posted(self):
        f = self.tmp / 'posted'
        return f.read_text().split('\n')[:-1] if f.exists() else []

    def test_two_sessions_asking_at_once_post_one_comment_and_the_other_waits_its_turn(self):
        procs = [self.run_queue('ask', 'o/r', str(n), f'h{n}', wait=False) for n in (1, 2)]
        outs = sorted(p.communicate()[0].strip() for p in procs)
        self.assertEqual(len(self.posted()), 1, self.posted())
        self.assertEqual(outs[0], 'ASKED', outs)
        self.assertTrue(outs[1].startswith('QUEUED (position 1, next ask ~'), outs)
        waiting = '2' if self.posted() == ['ask 1'] else '1'
        self.assertEqual(self.run_queue('ask', 'o/r', waiting, f'h{waiting}', now_plus=3700), 'ASKED')
        self.assertEqual(sorted(self.posted()), ['ask 1', 'ask 2'])

    def test_the_same_head_is_never_asked_twice(self):
        self.run_queue('ask', 'o/r', '1', 'h1')
        self.assertEqual(self.run_queue('ask', 'o/r', '1', 'h1', now_plus=7200), 'ASKED')
        self.assertEqual(self.posted(), ['ask 1'])

    def test_a_refusal_pauses_every_pr_and_the_ask_goes_back_to_the_front(self):
        """13 Nov 2026, coordinator: the limit is account-wide (#4037's first ask, no comment of ours on it, was refused after other PRs' comments)."""
        (self.tmp / 'refuse_1').write_text('')
        self.assertTrue(self.run_queue('ask', 'o/r', '1', 'h1', GITAR_QUEUE_GAP_S='0').startswith('QUEUED'))   # posted, refused, so not done
        self.assertTrue(self.run_queue('ask', 'o/r', '2', 'h2', GITAR_QUEUE_GAP_S='0').startswith('QUEUED'), 'every PR waits for #1\'s 10 minutes')
        self.assertTrue(self.run_queue('ask', 'o/r', '1', 'h1', GITAR_QUEUE_GAP_S='0', now_plus=60).startswith('QUEUED'), 'inside the 10 minutes')
        (self.tmp / 'refuse_1').unlink()
        self.assertEqual(self.run_queue('ask', 'o/r', '1', 'h1', GITAR_QUEUE_GAP_S='0', now_plus=700), 'ASKED', 'the refused ask is first again')
        self.assertEqual(self.run_queue('ask', 'o/r', '2', 'h2', GITAR_QUEUE_GAP_S='0', now_plus=701), 'ASKED')
        self.assertEqual(self.posted(), ['ask 1', 'ask 1', 'ask 2'])

    def test_a_merged_pr_leaves_the_queue_and_a_moved_head_is_dropped(self):
        self.run_queue('ask', 'o/r', '1', 'h1')
        self.assertTrue(self.run_queue('ask', 'o/r', '2', 'h2').startswith('QUEUED'))
        (self.tmp / 'state_2').write_text('MERGED')
        self.assertEqual(self.run_queue('ask', 'o/r', '2', 'h2', now_plus=3700), 'DROPPED (merged)')
        self.assertEqual(self.run_queue('ask', 'o/r', '3', 'old3', now_plus=3800), 'DROPPED (head moved)')   # the fake's head for #3 is h3: the push after this ask is the watcher's next ask
        self.assertEqual(self.posted(), ['ask 1'])

    def test_a_thread_reply_goes_through_the_same_queue_and_counts_for_the_gap(self):
        body = self.tmp / 'body.md'
        body.write_text('Fixed in abc1234.')
        self.assertEqual(self.run_queue('reply', 'o/r', '1', '555', str(body)), 'SENT')
        self.assertTrue(self.run_queue('ask', 'o/r', '1', 'h1').startswith('QUEUED'), 'the reply used this PR\'s turn')
        self.assertEqual(self.posted(), ['reply 555'])

    def test_a_refusal_that_lands_after_the_settle_wait_still_sends_the_ask_back(self):
        """Gitar on #4031: Gitar answers 3-5 s after the post and the check ran at post + 8 s with "now minus 5 s", so it missed the refusal. The simulated clock moves 8 s on the settle wait."""
        (self.tmp / 'refuse_1').write_text('')
        self.assertTrue(self.run_queue('ask', 'o/r', '1', 'h1', GITAR_QUEUE_GAP_S='0', GITAR_QUEUE_SETTLE_MS='8000').startswith('QUEUED'))
        self.assertEqual(self.posted(), ['ask 1'])

    def test_the_same_reply_twice_is_one_comment_and_a_reply_on_a_refused_pr_says_queued(self):
        body = self.tmp / 'body.md'
        body.write_text('Fixed in abc1234.')
        self.run_queue('reply', 'o/r', '1', '555', str(body), GITAR_QUEUE_GAP_S='0')
        self.assertEqual(self.run_queue('reply', 'o/r', '1', '555', str(body), GITAR_QUEUE_GAP_S='0'), 'SENT')
        self.assertEqual(self.posted(), ['reply 555'], 'the second run found the same reply already sent')
        (self.tmp / 'refuse_2').write_text('')
        self.run_queue('ask', 'o/r', '2', 'h2', GITAR_QUEUE_GAP_S='0')   # refused: PR 2 now waits 10 minutes
        body.write_text('Another answer.')
        self.assertTrue(self.run_queue('reply', 'o/r', '2', '777', str(body), GITAR_QUEUE_GAP_S='0').startswith('QUEUED (position 2'), 'not SENT while its PR waits (the refused ask is first)')
        self.assertEqual(self.posted(), ['reply 555', 'ask 2'])

    def test_a_github_that_answers_nothing_never_crashes_the_ask_and_the_failure_is_said(self):
        (self.tmp / 'gh_out').write_text('')
        out = self.run_queue('ask', 'o/r', '1', 'h1', GITAR_QUEUE_GAP_S='0')
        self.assertTrue(out.startswith('QUEUED (position 1') and 'the last look failed' in out, out)
        (self.tmp / 'gh_out').unlink()
        self.assertEqual(self.run_queue('ask', 'o/r', '1', 'h1', GITAR_QUEUE_GAP_S='0'), 'ASKED', 'the next look retries')

    def test_posts_on_different_prs_are_eleven_minutes_apart_by_default(self):
        """13 Nov 2026, coordinator: space asks across all PRs by a minimum gap; measured: 3 asks in 10 minutes get refused, so 11 minutes; a reply counts as an ask."""
        env = {k: v for k, v in self.env.items() if k != 'GITAR_QUEUE_GAP_S'}
        self.env = env
        body = self.tmp / 'body.md'
        body.write_text('Fixed.')
        self.assertEqual(self.run_queue('reply', 'o/r', '1', '555', str(body)), 'SENT')
        self.assertTrue(self.run_queue('ask', 'o/r', '2', 'h2', now_plus=100).startswith('QUEUED'), 'a reply took the turn 100 s ago')
        self.assertEqual(self.run_queue('ask', 'o/r', '2', 'h2', now_plus=670), 'ASKED')

    def test_a_reply_to_a_closed_pr_is_dropped_not_sent(self):
        """Gitar on #4031: `reply` printed SENT for an entry that drain had dropped."""
        (self.tmp / 'state_1').write_text('MERGED')
        body = self.tmp / 'body.md'
        body.write_text('Fixed.')
        self.assertEqual(self.run_queue('reply', 'o/r', '1', '555', str(body)), 'DROPPED (merged)')
        self.assertEqual(self.posted(), [])

    def test_a_refused_reply_is_taken_back_and_posted_again_after_the_wait(self):
        """Gitar on #4031 + the owner's rule (fix in code, never argue in the thread): a refused reply is not lost and not seen twice: deleted, then posted once after the pause."""
        body = self.tmp / 'body.md'
        body.write_text('Fixed.')
        (self.tmp / 'refuse_1').write_text('')
        out = self.run_queue('reply', 'o/r', '1', '555', str(body), GITAR_QUEUE_GAP_S='0', GITAR_QUEUE_SETTLE_MS='8000')
        self.assertTrue(out.startswith('QUEUED'), out)
        self.assertEqual(self.posted(), ['reply 555', 'delete 9555'])
        (self.tmp / 'refuse_1').unlink()
        self.assertEqual(self.run_queue('reply', 'o/r', '1', '555', str(body), GITAR_QUEUE_GAP_S='0', now_plus=700), 'SENT')
        self.assertEqual(self.posted(), ['reply 555', 'delete 9555', 'reply 555'])

    def test_a_refusal_on_a_pr_the_queue_never_saw_pauses_a_queued_reply(self):
        """13 Nov 2026, coordinator: #4042 (not queued) drew "wait about 40 minutes" at 21:08:37; the queue read refusals only on queued PRs, so its reply for another PR would have posted at 21:19 and extended the lock for everyone."""
        (self.tmp / 'comments_99.json').write_text(json.dumps([{'user': {'login': 'gitar-bot[bot]'}, 'created_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),  # clock: relative the refusal is read against the queue's own clock seconds later
            'body': "You've sent several Gitar comments in a short window. Please wait about 40 minutes and comment again."}]))   # a hand-posted ask on a PR this queue never saw
        body = self.tmp / 'body.md'
        body.write_text('Fixed.')
        out = self.run_queue('reply', 'o/r', '1', '555', str(body), GITAR_QUEUE_GAP_S='0')
        self.assertTrue(out.startswith('QUEUED'), out)
        self.assertEqual(self.posted(), [], 'nothing is posted inside the 40 minutes')

    def test_a_draft_or_dont_merge_pr_is_held_and_takes_no_slot(self):
        """13 Nov 2026, coordinator: the 11-minute slots go only to PRs that can become ready."""
        (self.tmp / 'draft_1').write_text('')
        (self.tmp / 'title_2').write_text('[xx] DONT MERGE A change')
        self.assertTrue(self.run_queue('ask', 'o/r', '1', 'h1').startswith('HELD (draft'))
        self.assertTrue(self.run_queue('ask', 'o/r', '2', 'h2').startswith('HELD (DONT MERGE'))
        self.assertEqual(self.run_queue('ask', 'o/r', '3', 'h3'), 'ASKED', 'the held PRs took no slot')
        self.assertIn('held (draft)', self.run_queue('status'))
        (self.tmp / 'draft_1').unlink()
        self.assertEqual(self.run_queue('ask', 'o/r', '1', 'h1', now_plus=3700), 'ASKED', 'it re-enters when it is ready')

    def test_an_ask_waits_while_all_checks_passed_is_red_or_pending_and_a_reply_does_not(self):
        for state, word in (('red', 'checks red'), ('pending', 'checks pending')):
            (self.tmp / 'checks_1').write_text(state)
            self.assertTrue(self.run_queue('ask', 'o/r', '1', 'h1').startswith(f'HELD ({word}'), state)
        body = self.tmp / 'body.md'
        body.write_text('Fixed.')
        self.assertEqual(self.run_queue('reply', 'o/r', '1', '555', str(body)), 'SENT', 'a reply is not held by the checks')
        (self.tmp / 'checks_1').unlink()
        self.assertEqual(self.run_queue('ask', 'o/r', '1', 'h1', now_plus=3700), 'ASKED', 'green: it goes')
        self.assertEqual(self.posted(), ['reply 555', 'ask 1'])

    def test_a_refusal_on_another_pr_during_the_settle_pauses_but_does_not_take_this_post_back(self):
        """13 Nov 2026, Gitar on #4053: the post-send check read every PR's refusals, so another PR's refusal re-queued an accepted ask and it was posted twice."""
        (self.tmp / 'side_refuse_1').write_text('99')
        self.assertEqual(self.run_queue('ask', 'o/r', '1', 'h1'), 'ASKED')
        self.assertIn('ask 1', self.posted())
        self.assertEqual(self.posted(), ['ask 1'])

    def test_an_unreadable_refusal_read_posts_nothing_that_look(self):
        """13 Nov 2026, Gitar on #4058: a failed read was taken as "no refusal anywhere" and the post extended Gitar's lock."""
        (self.tmp / 'graphql_down').write_text('')
        self.assertTrue(self.run_queue('ask', 'o/r', '1', 'h1', GITAR_QUEUE_GAP_S='0').startswith('QUEUED'))
        self.assertEqual(self.posted(), [])
        (self.tmp / 'graphql_down').unlink()
        self.assertEqual(self.run_queue('ask', 'o/r', '1', 'h1', GITAR_QUEUE_GAP_S='0'), 'ASKED', 'the next readable look posts')

    def test_when_every_entry_is_held_the_refusal_read_is_skipped(self):
        """13 Nov 2026, Gitar on #4058: held entries never post, so each watcher look must not run the 100-PR read."""
        (self.tmp / 'draft_1').write_text('')
        self.run_queue('ask', 'o/r', '1', 'h1', GITAR_QUEUE_GAP_S='0')
        self.run_queue('ask', 'o/r', '1', 'h1', GITAR_QUEUE_GAP_S='0')
        calls = (self.tmp / 'calls').read_text() if (self.tmp / 'calls').exists() else ''
        self.assertNotIn('api graphql', calls)

    def test_a_repo_without_an_all_checks_passed_gate_does_not_hold_an_ask_but_an_empty_rollup_waits(self):
        """13 Nov 2026, Gitar on #4058: a rollup without the gate held an ask forever; an empty one (CI not started) still waits."""
        (self.tmp / 'checks_1').write_text('none')
        self.assertTrue(self.run_queue('ask', 'o/r', '1', 'h1').startswith('HELD (checks pending'))
        (self.tmp / 'checks_1').write_text('nogate')
        self.assertEqual(self.run_queue('ask', 'o/r', '1', 'h1'), 'ASKED')

    def test_a_read_that_fails_right_after_the_post_is_said_not_taken_as_no_refusal(self):
        """13 Nov 2026, Gitar on #4071: the post-send read ignored `unreadable`, so a possible refusal was silently taken as none."""
        (self.tmp / 'down_after_post_1').write_text('')
        self.assertEqual(self.run_queue('ask', 'o/r', '1', 'h1'), 'ASKED')
        self.assertIn('GitHub could not be read after the post', self.run_queue('status'))

    def test_the_could_not_be_read_note_clears_on_a_readable_look_even_inside_a_pause(self):
        """13 Nov 2026, Gitar on #4071: the note was cleared only after the pause check, so a paused queue showed a stale failure."""
        (self.tmp / 'graphql_down').write_text('')
        self.assertIn('the last look failed', self.run_queue('ask', 'o/r', '1', 'h1', GITAR_QUEUE_GAP_S='0'))
        (self.tmp / 'graphql_down').unlink()
        (self.tmp / 'comments_99.json').write_text(json.dumps([{'user': {'login': 'gitar-bot[bot]'}, 'created_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),  # clock: relative the refusal is read against the queue's own clock seconds later
            'body': "You've sent several Gitar comments in a short window. Please wait about 40 minutes and comment again."}]))
        out = self.run_queue('ask', 'o/r', '1', 'h1', GITAR_QUEUE_GAP_S='0')
        self.assertTrue(out.startswith('QUEUED') and 'could not be read' not in out, out)


if __name__ == '__main__':
    unittest.main()
