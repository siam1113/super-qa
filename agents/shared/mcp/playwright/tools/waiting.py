"""Waiting tools for Playwright MCP Server."""
import logging
import time
import re
from datetime import datetime
from typing import Literal, Optional, Dict, Any, Union

from ..context import get_browser_manager
from ..types import ActionStatus

logger = logging.getLogger(__name__)


async def wait_for_selector(
    page_id: str,
    selector: str,
    state: Literal["attached", "detached", "visible", "hidden"] = "visible",
    timeout: int = 30000,
) -> Dict[str, Any]:
    """
    Wait for an element to reach a specified state.

    Args:
        page_id: The page to wait in
        selector: Playwright selector to find the element
        state: State to wait for:
            - attached: Element is in DOM
            - detached: Element is removed from DOM
            - visible: Element is visible
            - hidden: Element is hidden or removed
        timeout: Maximum time to wait in milliseconds

    Returns:
        Wait result with success status and timing
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "success": False,
            "status": ActionStatus.ERROR.value,
            "waitType": "selector",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        element = page.locator(selector)
        await element.wait_for(state=state, timeout=timeout)

        duration_ms = int((time.time() - start_time) * 1000)

        logger.info(f"Wait for {selector} ({state}) completed in {duration_ms}ms")

        return {
            "success": True,
            "status": ActionStatus.SUCCESS.value,
            "waitType": "selector",
            "selector": selector,
            "state": state,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)

        logger.warning(f"Wait for {selector} ({state}) failed: {error_msg}")

        return {
            "success": False,
            "status": ActionStatus.FAILED.value,
            "waitType": "selector",
            "selector": selector,
            "state": state,
            "errorMessage": error_msg,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def wait_for_navigation(
    page_id: str,
    url_pattern: Optional[str] = None,
    wait_until: Literal["load", "domcontentloaded", "networkidle", "commit"] = "load",
    timeout: int = 30000,
) -> Dict[str, Any]:
    """
    Wait for navigation to complete.

    Args:
        page_id: The page to wait in
        url_pattern: Optional URL pattern to wait for (regex supported)
        wait_until: When to consider navigation complete
        timeout: Maximum time to wait in milliseconds

    Returns:
        Wait result with final URL and timing
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "success": False,
            "status": ActionStatus.ERROR.value,
            "waitType": "navigation",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        if url_pattern:
            # Wait for URL to match pattern
            try:
                pattern = re.compile(url_pattern)
                await page.wait_for_url(pattern, wait_until=wait_until, timeout=timeout)
            except re.error:
                # Fall back to string match
                await page.wait_for_url(url_pattern, wait_until=wait_until, timeout=timeout)
        else:
            # Wait for load state
            await page.wait_for_load_state(wait_until, timeout=timeout)

        duration_ms = int((time.time() - start_time) * 1000)

        logger.info(f"Wait for navigation completed in {duration_ms}ms")

        return {
            "success": True,
            "status": ActionStatus.SUCCESS.value,
            "waitType": "navigation",
            "url": page.url,
            "urlPattern": url_pattern,
            "waitUntil": wait_until,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)

        return {
            "success": False,
            "status": ActionStatus.FAILED.value,
            "waitType": "navigation",
            "url": page.url,
            "urlPattern": url_pattern,
            "waitUntil": wait_until,
            "errorMessage": error_msg,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def wait_for_load_state(
    page_id: str,
    state: Literal["load", "domcontentloaded", "networkidle"] = "load",
    timeout: int = 30000,
) -> Dict[str, Any]:
    """
    Wait for a specific page load state.

    Args:
        page_id: The page to wait in
        state: Load state to wait for:
            - load: Wait for 'load' event
            - domcontentloaded: Wait for 'DOMContentLoaded' event
            - networkidle: Wait until no network activity for 500ms
        timeout: Maximum time to wait in milliseconds

    Returns:
        Wait result with success status and timing
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "success": False,
            "status": ActionStatus.ERROR.value,
            "waitType": "loadState",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        await page.wait_for_load_state(state, timeout=timeout)

        duration_ms = int((time.time() - start_time) * 1000)

        logger.info(f"Wait for load state '{state}' completed in {duration_ms}ms")

        return {
            "success": True,
            "status": ActionStatus.SUCCESS.value,
            "waitType": "loadState",
            "state": state,
            "url": page.url,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)

        return {
            "success": False,
            "status": ActionStatus.FAILED.value,
            "waitType": "loadState",
            "state": state,
            "errorMessage": error_msg,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def wait_for_timeout(
    page_id: str,
    timeout: int,
) -> Dict[str, Any]:
    """
    Wait for a fixed timeout (use sparingly, prefer explicit waits).

    Args:
        page_id: The page context (for consistency)
        timeout: Time to wait in milliseconds

    Returns:
        Wait result confirming the wait completed
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "success": False,
            "status": ActionStatus.ERROR.value,
            "waitType": "timeout",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        await page.wait_for_timeout(timeout)

        duration_ms = int((time.time() - start_time) * 1000)

        logger.debug(f"Fixed timeout of {timeout}ms completed")

        return {
            "success": True,
            "status": ActionStatus.SUCCESS.value,
            "waitType": "timeout",
            "requestedMs": timeout,
            "actualMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)

        return {
            "success": False,
            "status": ActionStatus.FAILED.value,
            "waitType": "timeout",
            "requestedMs": timeout,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def wait_for_url(
    page_id: str,
    url_pattern: str,
    timeout: int = 30000,
) -> Dict[str, Any]:
    """
    Wait for the page URL to match a pattern.

    Args:
        page_id: The page to wait in
        url_pattern: URL pattern to wait for (string or regex)
        timeout: Maximum time to wait in milliseconds

    Returns:
        Wait result with final URL and timing
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "success": False,
            "status": ActionStatus.ERROR.value,
            "waitType": "url",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        # Try as regex first
        try:
            pattern = re.compile(url_pattern)
            await page.wait_for_url(pattern, timeout=timeout)
        except re.error:
            # Fall back to string/glob match
            await page.wait_for_url(url_pattern, timeout=timeout)

        duration_ms = int((time.time() - start_time) * 1000)

        logger.info(f"Wait for URL '{url_pattern}' completed in {duration_ms}ms")

        return {
            "success": True,
            "status": ActionStatus.SUCCESS.value,
            "waitType": "url",
            "urlPattern": url_pattern,
            "actualUrl": page.url,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)

        return {
            "success": False,
            "status": ActionStatus.FAILED.value,
            "waitType": "url",
            "urlPattern": url_pattern,
            "actualUrl": page.url,
            "errorMessage": error_msg,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def wait_for_function(
    page_id: str,
    expression: str,
    timeout: int = 30000,
    polling: Union[Literal["raf", "mutation"], int] = "raf",
) -> Dict[str, Any]:
    """
    Wait for a JavaScript function to return a truthy value.

    Args:
        page_id: The page to wait in
        expression: JavaScript expression that returns truthy when condition is met
        timeout: Maximum time to wait in milliseconds
        polling: Polling strategy - 'raf' (requestAnimationFrame), 'mutation', or interval in ms

    Returns:
        Wait result with the return value from the expression
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "success": False,
            "status": ActionStatus.ERROR.value,
            "waitType": "function",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        result = await page.wait_for_function(
            expression,
            timeout=timeout,
            polling=polling,
        )

        # Get the result value
        result_value = await result.json_value()

        duration_ms = int((time.time() - start_time) * 1000)

        logger.info(f"Wait for function completed in {duration_ms}ms")

        return {
            "success": True,
            "status": ActionStatus.SUCCESS.value,
            "waitType": "function",
            "expression": expression[:100] + "..." if len(expression) > 100 else expression,
            "result": result_value,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)

        return {
            "success": False,
            "status": ActionStatus.FAILED.value,
            "waitType": "function",
            "expression": expression[:100] + "..." if len(expression) > 100 else expression,
            "errorMessage": error_msg,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def wait_for_response(
    page_id: str,
    url_pattern: str,
    timeout: int = 30000,
) -> Dict[str, Any]:
    """
    Wait for a network response matching a URL pattern.

    Args:
        page_id: The page to wait in
        url_pattern: URL pattern to match (substring match)
        timeout: Maximum time to wait in milliseconds

    Returns:
        Wait result with response details
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "success": False,
            "status": ActionStatus.ERROR.value,
            "waitType": "response",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        response = await page.wait_for_response(
            lambda resp: url_pattern in resp.url,
            timeout=timeout,
        )

        duration_ms = int((time.time() - start_time) * 1000)

        logger.info(f"Wait for response '{url_pattern}' completed in {duration_ms}ms")

        return {
            "success": True,
            "status": ActionStatus.SUCCESS.value,
            "waitType": "response",
            "urlPattern": url_pattern,
            "responseUrl": response.url,
            "httpStatus": response.status,
            "statusText": response.status_text,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)

        return {
            "success": False,
            "status": ActionStatus.FAILED.value,
            "waitType": "response",
            "urlPattern": url_pattern,
            "errorMessage": error_msg,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def wait_for_request(
    page_id: str,
    url_pattern: str,
    timeout: int = 30000,
) -> Dict[str, Any]:
    """
    Wait for a network request matching a URL pattern.

    Args:
        page_id: The page to wait in
        url_pattern: URL pattern to match (substring match)
        timeout: Maximum time to wait in milliseconds

    Returns:
        Wait result with request details
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "success": False,
            "status": ActionStatus.ERROR.value,
            "waitType": "request",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        request = await page.wait_for_request(
            lambda req: url_pattern in req.url,
            timeout=timeout,
        )

        duration_ms = int((time.time() - start_time) * 1000)

        logger.info(f"Wait for request '{url_pattern}' completed in {duration_ms}ms")

        return {
            "success": True,
            "status": ActionStatus.SUCCESS.value,
            "waitType": "request",
            "urlPattern": url_pattern,
            "requestUrl": request.url,
            "method": request.method,
            "resourceType": request.resource_type,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)

        return {
            "success": False,
            "status": ActionStatus.FAILED.value,
            "waitType": "request",
            "urlPattern": url_pattern,
            "errorMessage": error_msg,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }
