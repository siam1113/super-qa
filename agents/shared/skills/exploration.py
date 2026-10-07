"""Deterministic live exploration over the shared agent-browser MCP adapter."""
import asyncio
import hashlib
import ipaddress
import json
import os
import socket
from collections import deque
from typing import List, Optional
from urllib.parse import urljoin, urlsplit, urlunsplit

from pydantic import Field, field_validator, model_validator

from shared.live import get_live_registry
from shared.mcp.agent_browser.client import BrowserBudget, BrowserFailure, browser_session
from .contracts import Contract, SkillBlocked


def origin(url):
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Browser targets require an HTTP(S) URL without embedded credentials")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return parsed.scheme, parsed.hostname.lower(), port


class LiveTarget(Contract):
    base_url: str = Field(max_length=2000)
    allowed_domains: List[str] = Field(min_length=1, max_length=30)
    auth_profile: Optional[str] = Field(default=None, pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    allow_interactions: bool = Field(default=False, strict=True)
    ready_selector: Optional[str] = Field(default=None, min_length=1, max_length=500)
    excluded_paths: List[str] = Field(default_factory=lambda: ["/logout", "/signout"], max_length=100)

    @field_validator("allowed_domains")
    @classmethod
    def domains(cls, values):
        import re
        if any(not re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?", value) for value in values):
            raise ValueError("Use exact hostnames in allowed_domains, without wildcards, schemes or ports")
        return [value.lower() for value in values]

    @model_validator(mode="after")
    def valid_url(self):
        if origin(self.base_url)[1] not in self.allowed_domains:
            raise ValueError("The app hostname must be in allowed_domains")
        if any(not path.startswith("/") for path in self.excluded_paths):
            raise ValueError("excluded_paths must be absolute path prefixes")
        return self


def configured_targets():
    result = json.loads(os.getenv("QA_BROWSER_TARGETS", "{}"))
    if not isinstance(result, dict):
        raise SkillBlocked("QA_BROWSER_TARGETS must map target IDs to live browser configuration")
    return result


def target_for(value):
    targets = configured_targets()
    raw = targets.get(value.target_id)
    if raw is None:
        raise SkillBlocked("Configure this live target in QA_BROWSER_TARGETS")
    try:
        target = LiveTarget.model_validate(raw)
    except ValueError:
        raise SkillBlocked("Live browser target configuration is invalid") from None
    if value.actions and not target.allow_interactions:
        raise SkillBlocked("This target has not enabled browser interactions")
    if value.authenticate and not target.auth_profile:
        raise SkillBlocked("This target has no configured agent-browser auth profile")
    return target


def ensure_public_host(hostname):
    """Block ad-hoc exploration of loopback, private, link-local and other non-public addresses (SSRF guard)."""
    try:
        infos = socket.getaddrinfo(hostname, None)
    except OSError:
        raise SkillBlocked("Could not resolve this hostname") from None
    if not infos:
        raise SkillBlocked("Could not resolve this hostname")
    for info in infos:
        address = info[4][0].split("%")[0]
        if not ipaddress.ip_address(address).is_global:
            raise SkillBlocked("This host resolves to a private, local or reserved address and cannot be explored")


def adhoc_target_for(value):
    """Build an unregistered, single-use target for a site the user named directly, rather than a pre-configured one."""
    scheme, hostname, port = origin(value.url)
    ensure_public_host(hostname)
    return LiveTarget(base_url=value.url, allowed_domains=[hostname], allow_interactions=True)


def app_url(target, path):
    url = urljoin(target.base_url, path) if path is not None else target.base_url
    if origin(url) != origin(target.base_url):
        raise SkillBlocked("Navigation must stay on the configured application origin")
    return url


def can_visit(target, url):
    try:
        return origin(url) == origin(target.base_url) and not any(
            urlsplit(url).path.startswith(prefix) for prefix in target.excluded_paths)
    except ValueError:
        return False


def safe_url(url):
    # Query strings and fragments may contain session tokens; use hash IDs for graph identity.
    parsed = urlsplit(url)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))


def state_id(url, snapshot):
    return hashlib.sha256((url + "\n" + snapshot).encode()).hexdigest()[:20]


def redact(value, filled_values):
    """Avoid echoing explicitly entered data into the durable artifact."""
    if isinstance(value, str):
        for text in filled_values:
            if text:
                value = value.replace(text, "[entered value]")
        return value
    if isinstance(value, list):
        return [redact(item, filled_values) for item in value]
    if isinstance(value, dict):
        return {key: redact(item, filled_values) for key, item in value.items()}
    return value


async def explore_live(value, target, request_id, session_factory=browser_session):
    start = app_url(target, value.start_path)
    if not can_visit(target, start):
        raise SkillBlocked("The starting path is excluded by the target configuration")
    report = {"mode": "live", "provider": "agent-browser-mcp", "target_id": value.target_id, "target_url": value.url,
              "test_verdict": None, "pages": [], "transitions": [], "actions": [],
              "complete": False, "stop_reason": None, "untrusted_page_content": True,
              "authentication": "not_requested", "limitations": [
                  "Snapshots and links are observations, not proof of functional correctness.",
                  "Discovery visits links; GET requests and page scripts may affect application state.",
                  "Coverage is limited to reachable links and the explicitly requested actions."]}
    queue = deque()
    queued, visited = set(), set()
    filled_values = [step.value for step in value.actions if step.value]

    # No screenshot/image capability exists in agent-browser's exposed operation
    # set (BROWSER_BINDINGS) — this is a text-only live view: each visited page
    # becomes a pseudo "step" (reusing LiveStepState's shape so the existing
    # useLiveExecution hook/WebSocket needs no changes) with the accessibility
    # snapshot excerpt as its "result", not a frame. live.create's own
    # subscriber fan-out means a viewer can connect anytime from here on.
    live = get_live_registry()
    live.create(request_id, request_id, f"Exploring {target.base_url}")

    def publish_steps():
        # Redact entered values here too, not just in the final report below —
        # otherwise a live viewer sees unredacted form input (passwords, etc.)
        # streamed in real time even though the persisted artifact scrubs it.
        live.publish(request_id, {"type": "step", "steps": [{
            "stepId": page["id"], "stepNumber": index + 1, "description": redact(page["url"], filled_values),
            "stepType": "exploration", "status": "passed", "expectedResult": None,
            "actualResult": redact(page["snapshot"][:500], filled_values), "actions": [], "durationMs": 0, "errorMessage": None,
        } for index, page in enumerate(report["pages"])]})

    try:
        await explore_live_session(value, target, start, report, queue, queued, visited, filled_values, session_factory, publish_steps)
    finally:
        live.complete(request_id, "completed")
    return report


async def explore_live_session(value, target, start, report, queue, queued, visited, filled_values, session_factory, publish_steps):
    output_size = 0
    async with session_factory(target.allowed_domains, value.max_commands) as browser:
        async def observe(depth):
            nonlocal output_size
            current = await browser.call("get_url")
            url = current.get("url") if isinstance(current, dict) else None
            if not isinstance(url, str) or not can_visit(target, url):
                raise BrowserFailure("Browser navigated outside the configured application scope")
            snapshot = await browser.call("snapshot", interactive=False, compact=True, depth=12, includeUrls=False)
            if not isinstance(snapshot, dict) or not isinstance(snapshot.get("snapshot"), str) or not isinstance(snapshot.get("refs"), dict):
                raise BrowserFailure("Unsupported snapshot response from agent-browser")
            refs = snapshot["refs"]
            if any(not isinstance(info, dict) for info in refs.values()):
                raise BrowserFailure("Invalid snapshot element references")
            text = snapshot["snapshot"][:16000]
            identity = state_id(url, text)
            page = {"id": identity, "url": safe_url(url), "depth": depth,
                    "snapshot": text, "snapshot_truncated": len(snapshot["snapshot"]) > 16000,
                    "controls_truncated": len(refs) > 100,
                    "controls": [{"role": info.get("role"), "name": str(info.get("name", ""))[:300]}
                                 for info in list(refs.values())[:100]], "links": []}
            # Save the observation before optional link reads so budgets retain useful evidence.
            report["pages"].append(page)
            visited.add(url)
            publish_steps()
            output_size += len(json.dumps(page).encode())
            if output_size > 250000:
                raise BrowserBudget("output_budget")
            link_count = 0
            for ref, info in list(refs.items())[:100]:
                if info.get("role") != "link":
                    continue
                if link_count >= 10:
                    page["links_truncated"] = True
                    break
                link_count += 1
                href = await browser.call("get_attr", selector="@" + ref.lstrip("@"), name="href")
                raw = href.get("value") if isinstance(href, dict) else None
                if not isinstance(raw, str) or not raw:
                    continue
                destination = urljoin(url, raw)
                allowed = can_visit(target, destination)
                page["links"].append({"name": str(info.get("name", ""))[:300],
                                      "url": safe_url(destination) if allowed else None,
                                      "in_scope": allowed})
                if allowed and depth < value.max_depth and destination not in visited and destination not in queued:
                    if len(queued) < 100:
                        queue.append((destination, depth + 1, identity))
                        queued.add(destination)
                    else:
                        page["links_truncated"] = True
            return identity, refs

        async def run():
            if value.authenticate:
                report["authentication"] = "attempted"
                await browser.call("auth_login", name=target.auth_profile)
                report["authentication"] = "login_action_completed"
            await browser.call("open", url=start, headed=False)
            if target.ready_selector:
                await browser.call("wait_for_selector", selector=target.ready_selector, waitTimeoutMs=10000)
            previous, refs = await observe(0)
            for index, action in enumerate(value.actions):
                # max_pages includes states reached by interactions, not just distinct URLs.
                if len(report["pages"]) >= value.max_pages:
                    raise BrowserBudget("page_budget")
                selector = action.selector
                if action.role:
                    matches = [ref for ref, info in refs.items()
                               if info.get("role") == action.role and info.get("name") == action.name]
                    if len(matches) != 1:
                        raise BrowserFailure("Action role/name must match exactly one observed element")
                    selector = "@" + matches[0].lstrip("@")
                record = {"index": index, "action": action.action, "status": "attempted",
                          "target": {"selector": action.selector} if action.selector else
                                    {"role": action.role, "name": action.name},
                          "value_supplied": action.value is not None}
                report["actions"].append(record)
                if action.action == "wait":
                    await browser.call("wait_for_selector", selector=selector, waitTimeoutMs=10000)
                else:
                    if not action.role:
                        # Upstream get_count accepts CSS, not accessibility refs.
                        count = await browser.call("get_count", selector=selector)
                        if not isinstance(count, dict) or count.get("count") != 1:
                            raise BrowserFailure("Action selector must match exactly one element")
                    arguments = {"selector": selector}
                    if action.action == "fill":
                        arguments["text"] = action.value
                    elif action.action == "select":
                        arguments["values"] = [action.value]
                    await browser.call(action.action, **arguments)
                record["status"] = "command_completed"
                current, refs = await observe(0)
                report["transitions"].append({"from": previous, "to": current, "action_index": index})
                previous = current
            while queue:
                url, depth, parent = queue.popleft()
                if url in visited:
                    continue
                if len(report["pages"]) >= value.max_pages:
                    raise BrowserBudget("page_budget")
                await browser.call("open", url=url, headed=False)
                if target.ready_selector:
                    await browser.call("wait_for_selector", selector=target.ready_selector, waitTimeoutMs=10000)
                current, _ = await observe(depth)
                report["transitions"].append({"from": parent, "to": current, "action": "follow_link"})
            report["complete"] = True
            report["stop_reason"] = "requested_scope_exhausted"

        try:
            await asyncio.wait_for(run(), timeout=70)
        except BrowserBudget as error:
            report["stop_reason"] = str(error)
        except BrowserFailure as error:
            report["stop_reason"] = "browser_error"
            report["error"] = str(error)
        except asyncio.TimeoutError:
            report["stop_reason"] = "time_budget"
        if report["stop_reason"] != "time_budget" and browser.commands < value.max_commands:
            try:
                report["page_errors"] = await browser.call("errors")
            except (BrowserFailure, BrowserBudget):
                report["limitations"].append("Page errors could not be collected.")
        if any(page.get("links_truncated") or page.get("snapshot_truncated") or page.get("controls_truncated")
               for page in report["pages"]):
            report["complete"] = False
            if report["stop_reason"] == "requested_scope_exhausted":
                report["stop_reason"] = "observation_budget"
        report["commands"] = browser.commands
        report["pending_pages"] = len(queue)
        report["remaining_actions"] = len(value.actions) - sum(
            item["status"] == "command_completed" for item in report["actions"])
    report["browser_closed"] = not browser.cleanup_error
    if browser.cleanup_error:
        report["limitations"].append("Browser close failed; the session has a 60-second idle shutdown.")
    # Redact page-derived text only. A short fill value must not corrupt status
    # enums, state IDs, transition references, or operation names.
    for page in report["pages"]:
        page["snapshot"] = redact(page["snapshot"], filled_values)
        page["url"] = redact(page["url"], filled_values)
        for item in page["controls"] + page["links"]:
            item["name"] = redact(item["name"], filled_values)
            if item.get("url"):
                item["url"] = redact(item["url"], filled_values)
    if "page_errors" in report:
        report["page_errors"] = redact(report["page_errors"], filled_values)
    return report
