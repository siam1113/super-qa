"""Optional isolated Redis check for atomic app binding; never flushes a database."""
import asyncio
import os
import unittest

from sessions import SessionManager


@unittest.skipUnless(os.getenv("QA_SKILLS_REDIS_URL"), "Provide a dedicated QA_SKILLS_REDIS_URL fixture")
class SessionScopeRedisTests(unittest.IsolatedAsyncioTestCase):
    async def test_concurrent_app_binding_is_exclusive_and_preserves_json_arrays(self):
        sessions = SessionManager(os.environ["QA_SKILLS_REDIS_URL"])
        await sessions.connect()
        self.assertIsNotNone(sessions.client, "Redis check must not silently use the memory fallback")
        identity = await sessions.create_session("qae")
        try:
            outcomes = await asyncio.gather(sessions.bind_workflow_scope(identity, "qae", "app-one"),
                                            sessions.bind_workflow_scope(identity, "qae", "app-two"))
            self.assertEqual(sum(outcomes), 1)
            winner = "app-one" if outcomes[0] else "app-two"
            self.assertTrue(await sessions.bind_workflow_scope(identity, "qae", winner))
            self.assertFalse(await sessions.bind_workflow_scope(identity, "qae", None))
            self.assertFalse(await sessions.bind_workflow_scope(identity, "aue", winner))
            self.assertEqual((await sessions.get_session(identity))["messages"], [])
            await sessions.add_message(identity, {"role": "user", "content": "fixture"})
            self.assertEqual(len((await sessions.get_session(identity))["messages"]), 1)
        finally:
            await sessions.delete_session(identity)
            await sessions.disconnect()


if __name__ == "__main__":
    unittest.main()
