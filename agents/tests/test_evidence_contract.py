import copy
import hashlib
import os
import unittest
from unittest.mock import AsyncMock, Mock, patch

import httpx

from shared.evidence import retrieve_evidence


class EvidenceContractTests(unittest.IsolatedAsyncioTestCase):
    def fixture(self):
        quote = "Users must log in."
        citation = {"sourceId": "source", "documentId": "document", "revisionHash": "revision", "chunkId": "chunk", "quote": quote, "quoteHash": hashlib.sha256(quote.encode()).hexdigest()}
        citation["id"] = "source:source/document:document/revision:revision/chunk:chunk"
        return {"status": "evidence", "citations": [citation], "context": f"[Evidence {citation['id']}]\n{quote}"}

    async def invoke(self, payload):
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.post.return_value = Mock(json=Mock(return_value=payload), raise_for_status=Mock())
        with patch.dict(os.environ, {"AGENT_SOURCE_IDS": "source", "BACKEND_API_URL": "http://test/api"}), patch("shared.evidence.httpx.AsyncClient", return_value=client):
            result = await retrieve_evidence("login")
        client.post.assert_awaited_once_with("http://test/api/retrieval/query", json={"query": "login", "sourceIds": ["source"], "maxTokens": 2000})
        return result

    async def test_accepts_cited_quotes_without_authorizing_execution(self):
        result = await self.invoke(self.fixture())
        self.assertFalse(result["execution_authorized"])
        self.assertEqual(result["trust"], "untrusted_source_text")

    async def test_empty_evidence_is_explicit(self):
        self.assertEqual((await self.invoke({"status": "no_evidence", "citations": [], "context": ""}))["status"], "no_evidence")

    async def test_budget_exhaustion_is_not_no_matches(self):
        result = await self.invoke({"status": "budget_exhausted", "citations": [], "context": "", "omittedChunks": 1})
        self.assertEqual(result["status"], "budget_exhausted")

    def test_evidence_tool_is_registered_for_both_agents(self):
        from qae.tools import create_qae_tools
        from shared.tools import create_tools
        self.assertIn("retrieve_source_evidence", [tool.name for tool in create_qae_tools()])
        self.assertIn("retrieve_source_evidence", [tool.name for tool in create_tools("aue")])

    async def test_rejects_forged_or_unscoped_responses(self):
        for field, value in [("sourceId", "other"), ("quote", "Invented"), ("id", "fake"), ("quoteHash", "wrong")]:
            with self.subTest(field=field):
                payload = copy.deepcopy(self.fixture())
                payload["citations"][0][field] = value
                with self.assertRaises(ValueError):
                    await self.invoke(payload)
        payload = self.fixture()
        payload["context"] += "\nUncited claim"
        with self.assertRaises(ValueError):
            await self.invoke(payload)

    async def test_missing_scope_fails_before_network(self):
        with patch.dict(os.environ, {"AGENT_SOURCE_IDS": ""}), patch("shared.evidence.httpx.AsyncClient") as client:
            with self.assertRaises(ValueError):
                await retrieve_evidence("login")
            client.assert_not_called()

    async def test_http_failures_do_not_become_no_evidence(self):
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.post.side_effect = httpx.ConnectError("offline")
        with patch.dict(os.environ, {"AGENT_SOURCE_IDS": "source"}), patch("shared.evidence.httpx.AsyncClient", return_value=client):
            with self.assertRaises(httpx.ConnectError):
                await retrieve_evidence("login")


if __name__ == "__main__":
    unittest.main()
