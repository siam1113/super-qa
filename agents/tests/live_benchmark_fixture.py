"""Integration fixture: real worker and benchmark client against the test API."""
import json
import os
from pathlib import Path
import sys
import threading

import httpx

from shared.harness.autonomy import AutonomyClient
from shared.harness.benchmark import collect


stop = threading.Event()
errors = []
base = os.environ['BACKEND_API_URL'].rstrip('/') + '/'


def work():
    try:
        with httpx.Client(base_url=base, timeout=20, trust_env=False) as client:
            api = AutonomyClient(client, os.environ['AUTONOMY_PROJECT_KEY'])
            while not stop.is_set():
                if not api.run_once():
                    stop.wait(0.1)
    except Exception as error:
        errors.append(type(error).__name__)


worker = threading.Thread(target=work)
worker.start()
try:
    with httpx.Client(base_url=base, timeout=20, trust_env=False) as client:
        report = collect(AutonomyClient(client, os.environ['BENCHMARK_CI_KEY']), json.loads(Path(sys.argv[1]).read_text()), Path(sys.argv[2]), timeout=150)
finally:
    stop.set()
    worker.join(timeout=30)
if errors or worker.is_alive() or not report['report']['gatePassed']:
    raise SystemExit(1)
print(json.dumps(report['report']))
