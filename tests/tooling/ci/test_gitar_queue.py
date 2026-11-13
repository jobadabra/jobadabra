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
    if a[:2] == ['pr', 'view']:
        print(json.dumps({'state': open(f'{d}/state_{a[2]}').read().strip() if os.path.exists(f'{d}/state_{a[2]}') else 'OPEN', 'headRefOid': 'h' + a[2]}))
    elif a[:2] == ['pr', 'comment']:   # Gitar answers a PR that is under its limit with a refusal, 3 s later in real life, at once here
        if os.path.exists(f'{d}/refuse_{a[2]}'):
            rows = comments(a[2]); rows.append({'user': {'login': 'gitar-bot[bot]'}, 'created_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),  # clock: relative the refusal is read against the queue's own reading seconds later
                'body': "You've sent several Gitar comments in a short window. Please wait about 10 minutes and comment again."})
            json.dump(rows, open(f'{d}/comments_{a[2]}.json', 'w'))
        open(d + '/posted', 'a').write('ask ' + a[2] + '\\n')
    elif a[0] == 'api' and '-X' in a:
        open(d + '/posted', 'a').write('reply ' + a[3].split('/')[6] + '\\n')
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

    def test_a_refusal_pauses_only_that_pr_and_the_ask_goes_back_to_the_front(self):
        (self.tmp / 'refuse_1').write_text('')
        self.assertTrue(self.run_queue('ask', 'o/r', '1', 'h1', GITAR_QUEUE_GAP_S='0').startswith('QUEUED'))   # posted, refused, so not done
        self.assertEqual(self.run_queue('ask', 'o/r', '2', 'h2', GITAR_QUEUE_GAP_S='0'), 'ASKED', 'another PR is not held by #1')
        self.assertTrue(self.run_queue('ask', 'o/r', '1', 'h1', GITAR_QUEUE_GAP_S='0', now_plus=60).startswith('QUEUED'), 'inside its 10 minutes')
        (self.tmp / 'refuse_1').unlink()
        self.assertEqual(self.run_queue('ask', 'o/r', '1', 'h1', GITAR_QUEUE_GAP_S='0', now_plus=700), 'ASKED')
        self.assertEqual(self.posted(), ['ask 1', 'ask 2', 'ask 1'])

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
        self.assertTrue(out.startswith('QUEUED (position 1') and 'the last post failed' in out, out)
        (self.tmp / 'gh_out').unlink()
        self.assertEqual(self.run_queue('ask', 'o/r', '1', 'h1', GITAR_QUEUE_GAP_S='0'), 'ASKED', 'the next look retries')


if __name__ == '__main__':
    unittest.main()
