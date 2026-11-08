"""An e2e job's verdict is its suite, never an artifact upload after it.

Why (8 Nov 2026, runs 42435765170 and 5 Nov applyflows-1of3): the suite passed, the runner lost DNS while uploading its report
(Failed to CreateArtifact: ENOTFOUND), the job went red and the nightly was skipped as "main's e2e still red".
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = ['e2e.yml', 'e2e-windows.yml', 'desktop.yml']


def upload_steps(text):
    """Yields (step name, step block) for every actions/upload-artifact step, by YAML indentation."""
    for block in re.split(r'(?m)^(?=\s*- name: )', text):
        if re.search(r'(?m)^\s*uses: actions/upload-artifact@', block):
            yield block.splitlines()[0].strip(), block


class UploadNotVerdict(unittest.TestCase):
    def test_every_upload_continues_on_error(self):
        missing = []
        for name in WORKFLOWS:
            steps = list(upload_steps((ROOT / '.github/workflows' / name).read_text()))
            self.assertTrue(steps, f'{name}: no upload step found, the reader is wrong')
            missing += [f'{name}: {step}' for step, block in steps if not re.search(r'(?m)^\s*continue-on-error: true', block)]
        self.assertEqual(missing, [], 'an upload failure would turn a passed suite red')


if __name__ == '__main__':
    unittest.main()
