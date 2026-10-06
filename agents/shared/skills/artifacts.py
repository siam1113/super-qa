"""Versioned result references and immutable, retryable app publication."""
import asyncio
import hashlib
import hmac
import json
import os
import time
from pathlib import Path
from uuid import UUID

import httpx

from .contracts import ArtifactReference


def seal_result(result, scope):
    payload = {key: value for key, value in result.items() if key not in ("artifact", "publication")}
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    reference = ArtifactReference(artifact_id=result["request_id"], scope_id=scope,
        artifact_type="qa.skill." + result["skill"], content_hash=hashlib.sha256(encoded.encode()).hexdigest(),
        producer=result["agent_type"] + "." + result["skill"], created_at=result["created_at"])
    return reference.model_dump(mode="json"), encoded


async def publish_pending(store, limit=10):
    key = os.getenv("AGENT_MEMORY_SIGNING_KEY", "")
    if len(key) < 32:
        return
    pending_rows = store.pending_publications(limit)
    if not pending_rows:
        return
    base = os.getenv("BACKEND_API_URL", "http://localhost:4000/api").rstrip("/")
    async with httpx.AsyncClient(timeout=5, follow_redirects=False) as client:
        for pending in pending_rows:
            request_id, scope, role, skill, payload = pending
            timestamp = str(int(time.time() * 1000))
            signed = "qa-workflow-artifact-v1\n" + "\n".join((timestamp, scope, request_id, role, skill, payload))
            signature = hmac.new(key.encode(), signed.encode(), hashlib.sha256).hexdigest()
            try:
                response = await client.post(base + "/workflow-artifacts", json={"projectId": scope,
                    "requestId": request_id, "agentType": role, "skill": skill, "resultJson": payload},
                    headers={"x-workflow-timestamp": timestamp, "x-workflow-signature": signature})
                response.raise_for_status()
                receipt = response.json()
                if receipt.get("requestId") != request_id or receipt.get("contentHash") != hashlib.sha256(payload.encode()).hexdigest():
                    continue
                UUID(receipt["id"])
                store.record_publication(request_id, receipt)
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                # The committed outbox survives unavailability and process restarts.
                # Never persist response bodies, which may contain private server data.
                continue


async def publication_worker():
    from .runtime import RunStore, workflow_db_path
    cursor = 0
    while True:
        try:
            base = Path(workflow_db_path())
            paths = sorted(path for path in base.parent.glob(base.stem + "-*" + base.suffix)
                           if path.is_file() and not path.is_symlink())
            if paths:
                cursor %= len(paths)
                batch = (paths[cursor:] + paths[:cursor])[:32]
                cursor = (cursor + len(batch)) % len(paths)
                semaphore = asyncio.Semaphore(4)

                async def publish(path):
                    async with semaphore:
                        try:
                            await publish_pending(RunStore(path), limit=1)
                        except Exception:
                            # Keep other apps progressing when one store is unavailable.
                            return

                await asyncio.gather(*(publish(path) for path in batch))
        except Exception:
            pass
        await asyncio.sleep(30)
