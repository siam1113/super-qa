"""Run with PYTHONPATH=agents python3 -m shared.harness.worker."""
import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Callable, Optional

import httpx
from langchain_core.messages import HumanMessage

from shared.llm import LLMConfig, LLMProvider, create_llm

logger = logging.getLogger(__name__)


def create_model(job: dict):
    profile = job["profile"]
    provider = LLMProvider(profile["provider"])
    key = os.getenv("OPENAI_API_KEY") if provider == LLMProvider.OPENAI else os.getenv("ANTHROPIC_API_KEY")
    config = LLMConfig(provider=provider, model=profile["model"], temperature=0,
                       max_tokens=job["maxOutputTokens"], max_retries=0, api_key=key,
                       base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434") if provider == LLMProvider.OLLAMA else None)
    return create_llm(config)


def parse_response(response) -> dict:
    usage = getattr(response, "usage_metadata", None)
    measured = None
    if isinstance(usage, dict) and all(type(usage.get(key)) is int and usage[key] >= 0 for key in ("input_tokens", "output_tokens")):
        measured = {"inputTokens": usage["input_tokens"], "outputTokens": usage["output_tokens"]}
    result = {"usage": measured} if measured is not None else {}
    if getattr(response, "tool_calls", None):
        return {**result, "outcome": "blocked", "reason": "Tool calls are not permitted by this harness"}
    content = response.content
    if isinstance(content, list):
        if any(not isinstance(block, dict) or block.get("type") != "text" for block in content):
            return {**result, "outcome": "blocked", "reason": "Unsupported response content"}
        content = "".join(block.get("text", "") for block in content)
    if not isinstance(content, str) or len(content.encode("utf-8")) > 32000:
        return {**result, "outcome": "blocked", "reason": "Response exceeds artifact limit or is not text"}
    try:
        proposal = json.loads(content)
    except (ValueError, TypeError):
        return {**result, "outcome": "blocked", "reason": "Provider did not return strict JSON"}
    if not isinstance(proposal, dict):
        return {**result, "outcome": "blocked", "reason": "Provider returned no proposal object"}
    if proposal.get("kind") == "blocked":
        return {**result, "outcome": "blocked", "reason": "Clarification required: " + str(proposal.get("reason", "Insufficient evidence"))[:450]}
    return {**result, "outcome": "proposal", "proposal": proposal, "reason": "Unverified proposal; server validation and human review required"}


class HarnessWorker:
    def __init__(self, client: httpx.AsyncClient, key: str, model_factory: Callable = create_model):
        if len(key) < 32:
            raise ValueError("HARNESS_WORKER_KEY must contain at least 32 characters")
        self.client = client
        self.headers = {"x-harness-key": key}
        self.model_factory = model_factory

    async def request(self, method: str, path: str, body: Optional[dict] = None):
        response = await self.client.request(method, path, headers=self.headers, json=body)
        response.raise_for_status()
        return response.json() if response.content else None

    async def run_once(self) -> bool:
        job = await self.request("POST", "harness/worker/claim", {})
        if not job:
            return False
        lease = datetime.fromisoformat(job["leaseUntil"].replace("Z", "+00:00"))
        remaining = (lease - datetime.now(timezone.utc)).total_seconds() - 5
        if remaining <= 0:
            return True
        operation = None
        try:
            if len(job["prompt"].encode("utf-8")) + 1024 > job["inputTokenAllowance"]:
                raise ValueError("Prompt exceeds reserved input allowance")
            model = self.model_factory(job)
            operation = asyncio.create_task(model.ainvoke([HumanMessage(content=job["prompt"])]))
            end = asyncio.get_running_loop().time() + min(60, remaining)
            while not operation.done():
                wait = min(2, end - asyncio.get_running_loop().time())
                if wait <= 0:
                    raise asyncio.TimeoutError()
                await asyncio.wait({operation}, timeout=wait)
                if not operation.done():
                    state = await self.request("GET", f'harness/worker/{job["id"]}')
                    if state["status"] != "running":
                        operation.cancel()
                        return True
            completion = parse_response(await operation)
        except asyncio.TimeoutError:
            completion = {"outcome": "failed", "reason": "Provider deadline exceeded; reservation remains charged"}
        except asyncio.CancelledError:
            raise
        except Exception as error:
            completion = {"outcome": "failed", "reason": f"Provider/transport failure ({type(error).__name__}); usage unknown"}
        finally:
            if operation is not None and not operation.done():
                operation.cancel()
            if operation is not None:
                await asyncio.gather(operation, return_exceptions=True)
        body = {**completion, "token": job["token"]}
        for attempt in range(3):
            try:
                await self.request("POST", f'harness/worker/{job["id"]}/complete', body)
                return True
            except httpx.HTTPStatusError as error:
                if error.response.status_code == 409:
                    return True
                if error.response.status_code < 500:
                    raise
            except httpx.TransportError:
                pass
            await asyncio.sleep(attempt + 1)
        raise RuntimeError("Completion could not be persisted; lease recovery retains reservation")


async def main():
    from dotenv import load_dotenv
    load_dotenv()
    key = os.getenv("HARNESS_WORKER_KEY", "")
    url = os.getenv("BACKEND_API_URL", "http://localhost:4000/api").rstrip("/") + "/"
    async with httpx.AsyncClient(base_url=url, timeout=10, follow_redirects=False) as client:
        worker = HarnessWorker(client, key)
        while True:
            try:
                worked = await worker.run_once()
            except Exception as error:
                logger.error("Harness polling failed: %s", type(error).__name__)
                worked = False
            if not worked:
                await asyncio.sleep(5)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
