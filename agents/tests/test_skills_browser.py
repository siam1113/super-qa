"""Opt-in real sandbox exploration; runs only against a local static fixture."""
import os
import tempfile
import unittest
from pathlib import Path

from shared.harness.browser_executor import DockerBrowser, snapshot_bundle


@unittest.skipUnless(os.getenv("QA_SKILLS_BROWSER_E2E") == "1", "Set QA_SKILLS_BROWSER_E2E=1 with the updated sandbox image")
class BrowserExplorationTests(unittest.IsolatedAsyncioTestCase):
    async def test_observes_controls_links_and_errors_without_submitting_forms(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text('<title>Fixture home</title><h1>Home</h1><a href="/next.html">Next</a><a href="https://example.invalid/">External</a><form action="/submitted.html"><input id="email" aria-label="Email"><button>Submit</button></form>')
            (root / "next.html").write_text('<title>Next</title><h1>Next page</h1><script>throw new Error("fixture error")</script>')
            browser = DockerBrowser({"fixture": directory}, os.getenv("QA_SKILLS_BROWSER_IMAGE", "superqa-browser:skills"))
            job = {"targetId": "fixture", "targetHash": snapshot_bundle(root),
                   "explore": {"start_path": "/index.html", "max_pages": 4, "max_depth": 2}}
            result = await browser.execute(job)
            self.assertEqual(result.get("error"), "", result)
            self.assertEqual([item["path"] for item in result["pages"]], ["/index.html", "/next.html"])
            self.assertEqual(result["pages"][0]["controls"][0]["label"], "Email")
            self.assertEqual(result["pages"][1]["page_errors"], 1)
            self.assertFalse(result["page_budget_reached"])


if __name__ == "__main__":
    unittest.main()
