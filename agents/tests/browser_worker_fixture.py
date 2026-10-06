import asyncio
import json
import os
import httpx
from shared.harness.browser_executor import BrowserWorker, DockerBrowser


async def main():
    browser = DockerBrowser(json.loads(os.environ['HARNESS_BROWSER_TARGETS']), os.environ['HARNESS_BROWSER_IMAGE'])
    async with httpx.AsyncClient(base_url=os.environ['BACKEND_API_URL'].rstrip('/') + '/', timeout=10) as client:
        await BrowserWorker(client, os.environ['HARNESS_EXECUTOR_KEY'], browser).run_once()


if __name__ == '__main__':
    asyncio.run(main())
