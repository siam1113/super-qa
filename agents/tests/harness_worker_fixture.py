import asyncio
import os

import httpx
from langchain_core.messages import AIMessage
from shared.harness.worker import HarnessWorker


class FixtureModel:
    async def ainvoke(self, messages):
        return AIMessage(content=os.environ["HARNESS_FIXTURE_REPLY"], usage_metadata={"input_tokens": 100, "output_tokens": 100, "total_tokens": 200})


async def main():
    async with httpx.AsyncClient(base_url=os.environ["BACKEND_API_URL"].rstrip("/") + "/", timeout=5) as client:
        worker = HarnessWorker(client, os.environ["HARNESS_WORKER_KEY"], lambda job: FixtureModel())
        await worker.run_once()
        print("completed")


if __name__ == "__main__":
    asyncio.run(main())
