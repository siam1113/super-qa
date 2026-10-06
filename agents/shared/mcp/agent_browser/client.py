"""One private browser session per workflow, using official MCP stdio transport.

Only this adapter knows upstream tool names/envelopes. Model input never becomes
an MCP command, process argument, environment variable, or arbitrary JavaScript.
"""
import asyncio
import json
import os
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from shared.skills.contracts import SkillBlocked
from shared.skills.operations import operation


class BrowserFailure(Exception):
    pass


class BrowserBudget(Exception):
    pass


# The registered functions below are the only routes to the private MCP client.
BROWSER_BINDINGS = {
    "open": ("browser_navigate", "Navigate within the configured target domain allowlist."),
    "snapshot": ("browser_snapshot", "Read the current page accessibility snapshot."),
    "get_url": ("browser_read_url", "Read the current browser URL."),
    "get_attr": ("browser_read_attribute", "Read an element attribute, including observed link destinations."),
    "get_count": ("browser_count_elements", "Count CSS matches before an explicit action."),
    "click": ("browser_click", "Click a uniquely identified control when requested by the workflow input."),
    "fill": ("browser_fill", "Fill a uniquely identified field with explicit task data."),
    "check": ("browser_check", "Check an identified checkbox."),
    "uncheck": ("browser_uncheck", "Uncheck an identified checkbox."),
    "select": ("browser_select_option", "Select an explicit option in an identified control."),
    "hover": ("browser_hover", "Hover over an identified control."),
    "wait_for_selector": ("browser_wait_for_element", "Wait for an identified element within the browser timeout."),
    "errors": ("browser_read_errors", "Read browser error observations."),
    "auth_login": ("browser_login", "Use the target's configured authentication profile."),
    "close": ("browser_close", "Close the workflow's private browser session."),
}


def bind_browser_operation(upstream, name, description):
    @operation(name, description)
    async def invoke(browser, **arguments):
        return await browser._call(upstream, **arguments)
    return invoke


BROWSER_OPERATIONS = {upstream: bind_browser_operation(upstream, *metadata)
                      for upstream, metadata in BROWSER_BINDINGS.items()}
TOOLS = frozenset(BROWSER_OPERATIONS)
BROWSER_TOOL_NAMES = tuple(metadata[0] for metadata in BROWSER_BINDINGS.values())



class AgentBrowser:
    def __init__(self, client, session, domains, max_commands):
        self.client = client
        self.session = session
        self.domains = domains
        self.max_commands = max_commands
        self.commands = 0
        self.cleanup_error = False

    async def call(self, operation, **arguments):
        if operation not in TOOLS:
            raise ValueError("Unsupported browser operation")
        return await BROWSER_OPERATIONS[operation](self, **arguments)

    async def _call(self, operation, **arguments):
        if operation != "close":
            # Reserve the final command for error observations on partial runs.
            limit = self.max_commands if operation == "errors" else self.max_commands - 1
            if self.commands >= limit:
                raise BrowserBudget("command_budget")
            self.commands += 1
        # These values are owned here, never by page content or tool callers.
        arguments.update(session=self.session, allowedDomains=self.domains,
                         idleTimeout="60s", timeoutMs=5000 if operation == "close" else 15000)
        try:
            result = await asyncio.wait_for(
                self.client.call_tool("agent_browser_" + operation, arguments),
                timeout=7 if operation == "close" else 18)
        except asyncio.TimeoutError:
            raise BrowserFailure(operation + " timed out; its effects may have occurred") from None
        except Exception:
            raise BrowserFailure(operation + " MCP transport failed") from None
        envelope = result.structuredContent
        response = envelope.get("response") if isinstance(envelope, dict) else None
        if result.isError or not isinstance(response, dict) or response.get("success") is not True:
            # Upstream stdout/stderr can contain input values, URLs and auth data.
            raise BrowserFailure(operation + " failed; no successful action is claimed")
        return response.get("data")


@asynccontextmanager
async def browser_session(domains, max_commands):
    try:
        import anyio
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
    except ImportError:
        raise SkillBlocked("Live exploration requires Python >=3.10 and agents/requirements-mcp.txt") from None
    bundled = Path(__file__).resolve().parents[3] / "browser-mcp" / "node_modules" / ".bin" / "agent-browser"
    command = os.getenv("QA_AGENT_BROWSER_BIN") or (str(bundled) if bundled.is_file() else shutil.which("agent-browser"))
    if not command:
        raise SkillBlocked("Install agents/browser-mcp dependencies and Chromium, or set QA_AGENT_BROWSER_BIN")
    # Explicit config avoids project/user browser configuration, plugins and attach modes.
    # HOME is retained for upstream's encrypted auth vault; no app/model secrets are inherited.
    with TemporaryDirectory(prefix="superqa-browser-") as directory:
        config = Path(directory) / "browser.json"
        policy = Path(directory) / "policy.json"
        policy.write_text(json.dumps({"default": "allow", "deny": ["eval", "upload", "download"]}))
        config.write_text(json.dumps({"headed": False, "noWebmcp": True, "contentBoundaries": True,
                                      "maxOutput": 16000, "allowedDomains": domains,
                                      "actionPolicy": str(policy)}))
        environment = {"AGENT_BROWSER_CONFIG": str(config), "AGENT_BROWSER_PLUGINS": "[]",
                       "AGENT_BROWSER_NAMESPACE": "superqa", "AGENT_BROWSER_DEFAULT_TIMEOUT": "10000"}
        if os.getenv("AGENT_BROWSER_ENCRYPTION_KEY"):
            environment["AGENT_BROWSER_ENCRYPTION_KEY"] = os.environ["AGENT_BROWSER_ENCRYPTION_KEY"]
        # Upstream's core profile omits get_attr/get_count/hover. The private
        # transport uses all; only TOOLS above is reachable through this adapter.
        params = StdioServerParameters(command=command, args=["mcp", "--tools", "all"],
                                       env=environment, cwd=directory)
        with open(os.devnull, "w") as errors:
            async with stdio_client(params, errlog=errors) as (read, write):
                async with ClientSession(read, write) as client:
                    await asyncio.wait_for(client.initialize(), timeout=10)
                    browser = AgentBrowser(client, "qa-" + uuid4().hex, domains, max_commands)
                    try:
                        yield browser
                    finally:
                        # Also runs on cancellation. The daemon's idle timeout is a fallback.
                        with anyio.CancelScope(shield=True):
                            try:
                                await browser.call("close")
                            except Exception:
                                browser.cleanup_error = True
