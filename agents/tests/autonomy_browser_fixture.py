import asyncio
import json
import os

import httpx

from shared.harness.autonomy import AutonomyClient
from shared.harness.browser_executor import BrowserWorker, DockerBrowser


def suite_worker():
    with httpx.Client(base_url=os.environ['BACKEND_API_URL'].rstrip('/') + '/', timeout=15) as client:
        return AutonomyClient(client, os.environ['AUTONOMY_PROJECT_KEY']).run_once()


async def main():
    browser = DockerBrowser(json.loads(os.environ['HARNESS_BROWSER_TARGETS']), os.environ['HARNESS_BROWSER_IMAGE'])
    suite = asyncio.create_task(asyncio.to_thread(suite_worker))
    async with httpx.AsyncClient(base_url=os.environ['BACKEND_API_URL'].rstrip('/') + '/', timeout=15) as client:
        worker = BrowserWorker(client, os.environ['HARNESS_EXECUTOR_KEY'], browser)
        while not suite.done():
            await worker.run_once()
            await asyncio.sleep(0.2)
    await suite


if __name__ == '__main__':
    asyncio.run(main())
