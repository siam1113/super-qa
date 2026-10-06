import asyncio
import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx
from langchain_core.messages import AIMessage
from shared.harness.worker import HarnessWorker, create_model, parse_response


class ResponseTests(unittest.TestCase):
    def test_rejects_text_claims_and_retains_usage(self):
        response = AIMessage(content='All tests passed', usage_metadata={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15})
        result = parse_response(response)
        self.assertEqual(result["outcome"], "blocked")
        self.assertEqual(result["usage"], {"inputTokens": 10, "outputTokens": 5})

    def test_no_invented_usage(self):
        result = parse_response(AIMessage(content='{"kind":"blocked","reason":"Need an oracle"}'))
        self.assertNotIn("usage", result)
        self.assertEqual(result["outcome"], "blocked")

    def test_tool_calls_cannot_escape_policy(self):
        result = parse_response(AIMessage(content='', tool_calls=[{"id": "call-1", "name": "execute_shell", "args": {"cmd": "anything"}}]))
        self.assertEqual(result["outcome"], "blocked")

    def test_rejects_large_or_non_object_outputs(self):
        for content in ['[]', '"passed"', 'x' * 32001]:
            self.assertEqual(parse_response(AIMessage(content=content))["outcome"], "blocked")

    def test_provider_limits_disable_hidden_retries(self):
        with patch('shared.harness.worker.create_llm') as factory:
            create_model({"profile": {"provider": "ollama", "model": "fixture"}, "maxOutputTokens": 512})
            config = factory.call_args.args[0]
            self.assertEqual(config.max_tokens, 512)
            self.assertEqual(config.max_retries, 0)
            self.assertEqual(config.temperature, 0)


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.job = {"id": "run-1", "token": "lease-1", "prompt": "Fixture", "inputTokenAllowance": 1100,
                    "leaseUntil": (datetime.now(timezone.utc) + timedelta(seconds=70)).isoformat(), "maxOutputTokens": 512}
        self.calls = []
        self.model_calls = 0

    async def run_worker(self, responder, model):
        async with httpx.AsyncClient(base_url='http://fixture/api/', transport=httpx.MockTransport(responder)) as client:
            return await HarnessWorker(client, 'k' * 32, lambda job: model).run_once()

    async def test_transient_completion_retry_does_not_repeat_model(self):
        test = self

        class Model:
            async def ainvoke(self, messages):
                test.model_calls += 1
                return AIMessage(content='{"kind":"cases","cases":[]}')

        def respond(request):
            if request.url.path.endswith('/claim'):
                return httpx.Response(201, json=self.job)
            self.calls.append(json.loads(request.content))
            return httpx.Response(503 if len(self.calls) == 1 else 201, json={})

        await self.run_worker(respond, Model())
        self.assertEqual(self.model_calls, 1)
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(self.calls[0], self.calls[1])

    async def test_provider_failure_has_no_fallback_or_second_call(self):
        test = self

        class Model:
            async def ainvoke(self, messages):
                test.model_calls += 1
                raise RuntimeError('secret provider response must not be logged')

        def respond(request):
            if request.url.path.endswith('/claim'):
                return httpx.Response(201, json=self.job)
            self.calls.append(json.loads(request.content))
            return httpx.Response(201, json={})

        await self.run_worker(respond, Model())
        self.assertEqual(self.model_calls, 1)
        self.assertEqual(self.calls[0]["outcome"], 'failed')
        self.assertNotIn('secret', self.calls[0]["reason"])

    async def test_cancelled_run_cancels_inflight_task_without_completion(self):
        cancelled = asyncio.Event()

        class Model:
            async def ainvoke(self, messages):
                try:
                    await asyncio.sleep(60)
                finally:
                    cancelled.set()

        def respond(request):
            if request.url.path.endswith('/claim'):
                return httpx.Response(201, json=self.job)
            self.calls.append(request.method)
            return httpx.Response(200, json={"status": "cancelled"})

        await self.run_worker(respond, Model())
        self.assertTrue(cancelled.is_set())
        self.assertEqual(self.calls, ['GET'])

    async def test_oversized_prompt_is_not_sent_to_model(self):
        self.job["inputTokenAllowance"] = 1

        class Model:
            async def ainvoke(self, messages):
                raise AssertionError('Must not call model')

        def respond(request):
            if request.url.path.endswith('/claim'):
                return httpx.Response(201, json=self.job)
            self.calls.append(json.loads(request.content))
            return httpx.Response(201, json={})

        await self.run_worker(respond, Model())
        self.assertEqual(self.calls[0]['outcome'], 'failed')


if __name__ == '__main__':
    unittest.main()
