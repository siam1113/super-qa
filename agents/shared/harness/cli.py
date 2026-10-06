"""Operator interface for the durable harness, separate from legacy chat."""
import argparse
import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv


def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description='Submit and review bounded QAE/AUE proposals')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('submit').add_argument('file', type=Path)
    commands.add_parser('execute').add_argument('file', type=Path)
    for name in ('status', 'cancel', 'review', 'execution-status', 'execution-cancel', 'artifact'):
        command = commands.add_parser(name)
        command.add_argument('run_id')
        if name == 'review':
            command.add_argument('--decision', choices=('approved', 'rejected'), required=True)
            command.add_argument('--reviewer', required=True)
        if name == 'artifact':
            command.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    key = os.getenv('HARNESS_OPERATOR_KEY', '')
    if len(key) < 32:
        parser.error('HARNESS_OPERATOR_KEY must contain at least 32 characters')
    base = os.getenv('BACKEND_API_URL', 'http://localhost:4000/api').rstrip('/')
    body = None
    method = 'POST'
    if args.command in ('submit', 'execute'):
        if args.file.stat().st_size > 32000:
            parser.error('Task file exceeds 32 KB')
        body = json.loads(args.file.read_text())
        path = '/harness/runs' if args.command == 'submit' else '/harness/executions'
    else:
        from uuid import UUID
        run_id = str(UUID(args.run_id))
        execution = args.command.startswith('execution-') or args.command == 'artifact'
        path = ('/harness/executions/' if execution else '/harness/runs/') + run_id
        if args.command in ('status', 'execution-status', 'artifact'):
            method = 'GET'
            if args.command == 'artifact':
                path += '/artifact'
        else:
            path += '/' + args.command.replace('execution-', '')
            body = {'decision': args.decision, 'reviewer': args.reviewer} if args.command == 'review' else {}
    with httpx.Client(timeout=15, follow_redirects=False) as client:
        response = client.request(method, base + path, headers={'x-harness-key': key}, json=body)
        if not response.is_success:
            parser.exit(1, f'Harness request failed ({response.status_code}): {response.text}\n')
        result = response.json()
        if args.command == 'artifact':
            import base64
            import hashlib
            image = base64.b64decode(result['base64'], validate=True)
            if hashlib.sha256(image).hexdigest() != result['sha256']:
                parser.exit(1, 'Artifact hash mismatch\n')
            with args.output.open('xb') as target:
                target.write(image)
            print(str(args.output))
        else:
            print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
