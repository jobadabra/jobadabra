# Plan: a board's job links in seconds, so its jobs are checked in the same search

Verdict: one PR (#4022), two parts; folded together so one proof pair measures both and they cannot merge apart (sa, 13 Nov 2026). The owner said "yes" (13 Nov 2026, via sa) to finding and fixing why "job links" took 80 s on three Madrid boards (c04, run 43473395249). On 13 Nov 2026, asked via AskUserQuestion by sa, he chose "Sample per shape, AI decides (Recommended)" for the second lever.

## Measured cause
- `src/ai/decide_gate.py` handed every waiting caller ONE ask, and `src/ai/decide.py` `_ask` made its 50-wording calls in a row.
- So boards that queued together got their links only after the last batch of all of them: 145 + 300 + 57 wordings = 11 calls; all three got their links at 96 s.
- Run 43486113330 (per-call log on) shows two back-to-back chains of ~11 s calls and "no slot queue".

## Parts (one PR, #4022)
1. **Part 1** The gate asks one batch per lane call, the fewest wordings first; a board leaves when its own wordings are answered. Same calls; small boards get their links in seconds.
2. **Part 2** A board page's links are judged by shape: for a shape of 3+ links (path with digits folded and the last segment as *, depth 2 or more), the AI is asked about 3 of them, spread over the shape. If all 3 agree, the answer holds for the rest of that shape on that page; if they differ, every link of the shape is asked as today. Single links are always asked one by one. One page, one read; nothing stored. Measured on the saved Madrid pages: 502 → 120 wordings, 11 → 3 calls.

## Progress
- [x] part 1: one batch per lane call
- [x] part 2: links judged by shape
- [ ] the fair c04 pair (after the pair shares the board proposal on both sides)

## Not in this plan
- The 68 s "time is up" for boards and the 2 min 15 s AI stop.
- A board alone using both lanes (parked: needs a helper thread that would lose the caller's allowance and priority).
- `LANES` stays 2.
