"""One run-log line per AI call in a Find jobs press, to see where the 2:15 clock goes: which step asked when, how long it waited for a slot, when it was answered.
Off unless JOBADABRA_AI_CALL_LOG=1 (the Search check turns it on): a person's log shows nothing new. Why (7 Nov 2026, #2920, owner: "fix the ones below target"): every AI call is
about 12 s, the press's AI budget is 135 s, and the artifacts could not say whether employer titles waited for a slot, the hub or the budget share (the funnel's `ai_calls` is an estimate
from log lines, never a measurement). Tests: tests/unit/ai/test_ai_call_log.py."""
import os
import time

from .. import time_budget


def on():
    """True when this process was asked to log its calls (JOBADABRA_AI_CALL_LOG=1) and a press clock is running (time_budget.STARTED)."""
    return os.getenv('JOBADABRA_AI_CALL_LOG') == '1' and time_budget.STARTED is not None


def say(step, model, asked, waited, now=None):
    """Prints `AI call: <step> (<model>): asked at A s, waited W s for a slot, answered at E s (D s)`, A and E in seconds since the press began. Takes the monotonic time the
    call was asked and the seconds it waited for a slot; prints nothing when `on()` is false; never raises (a log line must not fail a call)."""
    try:
        if not on():
            return
        end = time.monotonic() if now is None else now
        began = time_budget.STARTED
        print(f"AI call: {step or 'unnamed'} ({model}): asked at {asked - began:.1f} s, waited {waited:.1f} s for a slot, answered at {end - began:.1f} s ({end - asked:.1f} s)", flush=True)
    except Exception:   # noqa: BLE001 — a measurement line is never worth a failed AI call
        pass
