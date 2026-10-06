"""Run: PYTHONPATH=agents python3 -m shared.skills.cli --help."""
import argparse
import asyncio
import json
from pathlib import Path

from dotenv import load_dotenv

from .registry import catalog
from .runtime import get_runtime
from .artifacts import publish_pending


def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description="Deterministic QA workflows and persisted artifacts")
    commands = parser.add_subparsers(dest="command", required=True)
    listing = commands.add_parser("list")
    listing.add_argument("--agent", choices=("qae", "aue"))
    execute = commands.add_parser("run")
    execute.add_argument("file", type=Path, help="JSON SkillRequest; allow_model defaults to false")
    status = commands.add_parser("status")
    status.add_argument("request_id")
    status.add_argument("--agent", required=True, choices=("qae", "aue"))
    commands.add_parser("publish", help="Retry pending artifact publications in the trusted configured scope")
    graph = commands.add_parser("graph")
    graph.add_argument("skill")
    graph.add_argument("--agent", required=True, choices=("qae", "aue"))
    args = parser.parse_args()
    try:
        if args.command == "list":
            result = catalog(args.agent)
        elif args.command == "run":
            if args.file.stat().st_size > 256000:
                parser.error("Request exceeds 256 KB")
            result = asyncio.run(get_runtime().run(json.loads(args.file.read_text())))
        elif args.command == "publish":
            asyncio.run(publish_pending(get_runtime().store))
            result = {"publication": "attempted", "pending": get_runtime().store.publication_count()}
        elif args.command == "graph":
            print(get_runtime().graph(args.skill, args.agent).get_graph().draw_mermaid())
            return
        else:
            result = get_runtime().store.get(args.request_id, args.agent)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        if isinstance(result, dict) and result.get("status") in ("blocked", "failed", "interrupted"):
            parser.exit(1)
    except (ValueError, OSError) as error:
        parser.exit(2, str(error) + "\n")


if __name__ == "__main__":
    main()
