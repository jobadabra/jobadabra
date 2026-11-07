"""Build fictional Focus/funnel UI data with the actual engine producers, without stores, AI or delivery."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from src import focus
from src.notion import funnel
from src.ui_copy import wire

data = focus.build([], [], target=2, now=datetime(2026, 11, 7, 12, tzinfo=timezone.utc))
data['test_funnel'] = funnel.funnel([])
print(json.dumps(wire(data), ensure_ascii=False))
