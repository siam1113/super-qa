"""Real stdio MCP round trip; run with requirements-mcp.txt on Python 3.10+."""
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4


@unittest.skipUnless(importlib.util.find_spec("mcp"), "MCP SDK requires the optional MCP environment")
class MCPWorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def test_stdio_discovery_invocation_validation_and_persistence(self):
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
        with tempfile.TemporaryDirectory() as directory:
            parameters = StdioServerParameters(command=sys.executable, args=["-m", "shared.mcp.qa.server"],
                env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1]),
                     "QA_WORKFLOW_DB": str(Path(directory) / "runs.sqlite3"), "QA_MCP_ROLE": "qae"})
            identity = str(uuid4())
            async with stdio_client(parameters) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    listing = await session.list_tools()
                    names = {tool.name for tool in listing.tools}
                    self.assertIn("plan_tests", names)
                    self.assertIn("explore_app", names)
                    self.assertNotIn("generate_automation", names)
                    result = await session.call_tool("build_test_matrix", {"request_id": identity, "dimensions": {"browser": ["chromium", "firefox"]}})
                    self.assertFalse(result.isError)
                    artifact = json.loads(result.content[0].text)
                    self.assertEqual(artifact["model_calls"], 0)
                    self.assertEqual(artifact["data"]["row_count"], 2)
                    duplicate = await session.call_tool("build_test_matrix", {"request_id": identity, "dimensions": {"browser": ["chromium", "firefox"]}})
                    self.assertEqual(json.loads(duplicate.content[0].text), artifact)
                    invalid = await session.call_tool("build_test_matrix", {"dimensions": {}, "invented": True})
                    self.assertTrue(invalid.isError)
                    wrong_role = await session.call_tool("generate_automation", {})
                    self.assertTrue(wrong_role.isError)
            # A different server process reads the same artifact.
            async with stdio_client(parameters) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    result = await session.call_tool("get_skill_run", {"request_id": identity})
                    self.assertFalse(result.isError)
                    self.assertEqual(json.loads(result.content[0].text), artifact)


if __name__ == "__main__":
    unittest.main()
