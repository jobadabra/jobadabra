"""Escalate a delegated PR's actionable ship events to its registered coordinator."""
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pr_events_cursor import deliver_pending  # noqa: E402

ACTION = re.compile(r'^ship: (?:FAILED|RED|CONFLICT|COMMENT|READY|MERGED|CLOSED)\b(?! FIXED)')


def deliver(log, surface, cmux, *, run=subprocess.run):
    """Copy actionable events with an independent retry cursor; never edit the worker's prompt.

    Invariants: no GitHub or model calls; acceptance is not an acknowledgement;
    coordinator failure cannot consume the worker's delivery cursor.
    """
    try:
        surface = str(uuid.UUID(surface)).upper()
    except (ValueError, TypeError, AttributeError):
        return True  # Invalid configuration is not a transient delivery failure; match the owning cmux notifier.

    def send(events):
        message = ('Delegated PR escalation. Verify the current GitHub head first; events may be superseded. '
                   'Ensure the owning worker acts on failures, conflicts and comments; a local fix or active watcher '
                   'is not a completed push. Seek worker acknowledgement; if it stops unresolved, unblock it. '
                   'Only report ready on READY for the current head. Never merge.\n'
                   + '\n'.join(events) + f'\nLog: {log}')
        return run([cmux, 'agent', 'message', surface, '--from', 'PR coordinator watcher', '--json', '--', message],
                   capture_output=True, text=True, timeout=15).returncode == 0

    return deliver_pending(log, f'{log}.coordinator-{surface}.json', ACTION, send)


def main():
    """Use an explicit coordinator or branch registration, so detached watchers retain routing."""
    if len(sys.argv) != 2:
        print('usage: pr-coordinator-events.py <ship-log>', file=sys.stderr)
        return 2
    surface = os.environ.get('SHIP_COORDINATOR_SURFACE')
    if not surface:
        branch = subprocess.run(['git', 'branch', '--show-current'], capture_output=True, text=True).stdout.strip()
        if branch:
            surface = subprocess.run(['git', 'config', '--get', f'branch.{branch}.shipCoordinator'],
                                     capture_output=True, text=True).stdout.strip()
    if not surface:
        return 0  # A solo PR still uses the existing owning-session notifier.
    cmux = os.environ.get('CMUX_BUNDLED_CLI_PATH') or shutil.which('cmux')
    if not cmux or not deliver(sys.argv[1], surface, cmux):
        print('pr-coordinator-events: delivery failed; events remain pending', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
