"""The hosted container's build stamp: a hash of every .py file of the engine (path and bytes), 12 hex. Standard library only and no package-relative
imports: the runner deploy runs this file as a script (`python3 src/build_stamp.py src`), because importing the `src` package loads .env and
registers an exit hook. The container's GET / answers the same value (src/hosted_run.py BUILD); the runner compares the two before each run."""
import hashlib
import sys
from pathlib import Path


def build_of(root):
    """-> 12 hex: a hash of every .py file under `root` (path and bytes), so it moves when any engine module does, with nothing to bump by hand."""
    digest = hashlib.sha256()
    for file in sorted(Path(root).rglob('*.py')):
        digest.update(str(file.relative_to(root)).encode() + b'\0' + file.read_bytes() + b'\0')
    return digest.hexdigest()[:12]


if __name__ == '__main__':
    print(build_of(Path(sys.argv[1])))
