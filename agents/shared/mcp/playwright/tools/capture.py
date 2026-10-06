"""Capture tools for Playwright MCP Server - screenshots, console logs, network."""
import logging
import time
import base64
from datetime import datetime
from typing import Literal, Optional, Dict, Any, List

from ..context import get_browser_manager
from ..types import ActionStatus

logger = logging.getLogger(__name__)


async def accessibility_snapshot(
    page_id: str,
    depth: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Capture the page's ARIA accessibility snapshot: a compact, YAML-like text view
    of what's actually on screen and clickable/fillable right now (roles, names,
    hierarchy). This is the primary grounding signal for deciding what to do next
    on a vague step — far cheaper and more precise for that purpose than full HTML
    or a screenshot.

    Args:
        page_id: The page to snapshot
        depth: Optional limit on how deep the snapshot tree goes

    Returns:
        A YAML-like string snapshot of the page's accessibility tree
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "status": ActionStatus.ERROR.value,
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        snapshot = await page.aria_snapshot(depth=depth)
        return {
            "status": ActionStatus.SUCCESS.value,
            "actionType": "accessibility_snapshot",
            "snapshot": snapshot,
            "durationMs": int((time.time() - start_time) * 1000),
            "timestamp": datetime.now().isoformat(),
        }
    except Exception as e:
        return {
            "status": ActionStatus.ERROR.value,
            "actionType": "accessibility_snapshot",
            "errorMessage": str(e),
            "durationMs": int((time.time() - start_time) * 1000),
            "timestamp": datetime.now().isoformat(),
        }


async def screenshot(
    page_id: str,
    full_page: bool = False,
    selector: Optional[str] = None,
    format: Literal["png", "jpeg"] = "png",
    quality: int = 80,
    omit_background: bool = False,
) -> Dict[str, Any]:
    """
    Capture a screenshot of the page or a specific element.

    Args:
        page_id: The page to screenshot
        full_page: Whether to capture the full scrollable page
        selector: Optional selector to screenshot a specific element
        format: Image format (png or jpeg)
        quality: JPEG quality (0-100), ignored for PNG
        omit_background: Make background transparent (PNG only)

    Returns:
        Screenshot result with base64 data and metadata
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "status": ActionStatus.ERROR.value,
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        # Build screenshot options
        options = {
            "type": format,
            "full_page": full_page,
        }

        if format == "jpeg":
            options["quality"] = quality
        elif format == "png" and omit_background:
            options["omit_background"] = True

        # Capture element or page screenshot
        if selector:
            element = page.locator(selector)
            screenshot_data = await element.screenshot(**options)
        else:
            screenshot_data = await page.screenshot(**options)

        duration_ms = int((time.time() - start_time) * 1000)

        # Get dimensions from the screenshot
        # Note: Actual dimensions would need image parsing, using placeholder
        result = {
            "status": ActionStatus.SUCCESS.value,
            "actionType": "screenshot",
            "screenshot": base64.b64encode(screenshot_data).decode(),
            "format": format,
            "fullPage": full_page,
            "selector": selector,
            "size": len(screenshot_data),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        logger.info(f"Screenshot captured: {len(screenshot_data)} bytes in {duration_ms}ms")
        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)

        return {
            "status": ActionStatus.ERROR.value,
            "actionType": "screenshot",
            "errorMessage": error_msg,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def get_console_logs(
    page_id: str,
    level_filter: Optional[Literal["log", "warn", "error", "info", "debug"]] = None,
    clear: bool = False,
    limit: int = 100,
) -> Dict[str, Any]:
    """
    Get console logs captured from the page.

    Args:
        page_id: The page to get logs from
        level_filter: Filter by log level
        clear: Clear logs after retrieving
        limit: Maximum number of logs to return

    Returns:
        List of console log entries
    """
    manager = get_browser_manager()
    page_state = manager.get_page_state(page_id)

    if not page_state:
        return {
            "status": ActionStatus.ERROR.value,
            "errorMessage": f"Page not found: {page_id}",
        }

    # Get logs
    logs = manager.get_console_logs(page_id, clear=clear)

    # Filter by level if specified
    if level_filter:
        logs = [log for log in logs if log.level == level_filter]

    # Apply limit
    logs = logs[-limit:]

    return {
        "status": ActionStatus.SUCCESS.value,
        "pageId": page_id,
        "logs": [
            {
                "level": log.level,
                "message": log.message,
                "timestamp": log.timestamp.isoformat(),
                "source": log.source,
                "lineNumber": log.line_number,
                "args": log.args,
            }
            for log in logs
        ],
        "totalCount": len(logs),
        "timestamp": datetime.now().isoformat(),
    }


async def get_network_requests(
    page_id: str,
    url_filter: Optional[str] = None,
    method_filter: Optional[Literal["GET", "POST", "PUT", "DELETE", "PATCH"]] = None,
    status_filter: Optional[int] = None,
    clear: bool = False,
    limit: int = 100,
) -> Dict[str, Any]:
    """
    Get network requests captured from the page.

    Args:
        page_id: The page to get requests from
        url_filter: Filter by URL substring
        method_filter: Filter by HTTP method
        status_filter: Filter by response status code
        clear: Clear requests after retrieving
        limit: Maximum number of requests to return

    Returns:
        List of network request entries
    """
    manager = get_browser_manager()
    page_state = manager.get_page_state(page_id)

    if not page_state:
        return {
            "status": ActionStatus.ERROR.value,
            "errorMessage": f"Page not found: {page_id}",
        }

    # Get requests
    requests = manager.get_network_requests(page_id, url_filter=url_filter, clear=clear)

    # Apply filters
    if method_filter:
        requests = [r for r in requests if r.method.upper() == method_filter]
    if status_filter:
        requests = [r for r in requests if r.status == status_filter]

    # Apply limit
    requests = requests[-limit:]

    return {
        "status": ActionStatus.SUCCESS.value,
        "pageId": page_id,
        "requests": [
            {
                "url": req.url,
                "method": req.method,
                "status": req.status,
                "resourceType": req.resource_type,
                "timestamp": req.timestamp.isoformat(),
                "requestHeaders": dict(req.request_headers) if req.request_headers else {},
                "responseHeaders": dict(req.response_headers) if req.response_headers else {},
                "failureText": req.failure_text,
            }
            for req in requests
        ],
        "totalCount": len(requests),
        "timestamp": datetime.now().isoformat(),
    }


async def get_page_content(
    page_id: str,
    content_type: Literal["html", "text", "inner_html", "inner_text"] = "html",
    selector: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Get the content of the page or a specific element.

    Args:
        page_id: The page to get content from
        content_type: Type of content to retrieve
        selector: Optional selector to get content from specific element

    Returns:
        Page or element content
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "status": ActionStatus.ERROR.value,
            "errorMessage": f"Page not found: {page_id}",
        }

    try:
        if selector:
            element = page.locator(selector)
            if content_type in ["html", "inner_html"]:
                content = await element.inner_html()
            else:
                content = await element.inner_text()
        else:
            if content_type in ["html", "inner_html"]:
                content = await page.content()
            else:
                content = await page.inner_text("body")

        return {
            "status": ActionStatus.SUCCESS.value,
            "pageId": page_id,
            "content": content,
            "contentType": content_type,
            "selector": selector,
            "length": len(content),
            "timestamp": datetime.now().isoformat(),
        }

    except Exception as e:
        return {
            "status": ActionStatus.ERROR.value,
            "errorMessage": str(e),
            "timestamp": datetime.now().isoformat(),
        }


async def evaluate(
    page_id: str,
    expression: str,
    arg: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Evaluate JavaScript expression in the page context.

    Args:
        page_id: The page to evaluate in
        expression: JavaScript expression to evaluate
        arg: Optional argument to pass to the expression

    Returns:
        Result of the JavaScript evaluation
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "status": ActionStatus.ERROR.value,
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        if arg is not None:
            result = await page.evaluate(expression, arg)
        else:
            result = await page.evaluate(expression)

        duration_ms = int((time.time() - start_time) * 1000)

        return {
            "status": ActionStatus.SUCCESS.value,
            "pageId": page_id,
            "expression": expression[:100] + "..." if len(expression) > 100 else expression,
            "result": result,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return {
            "status": ActionStatus.ERROR.value,
            "errorMessage": str(e),
            "expression": expression[:100] + "..." if len(expression) > 100 else expression,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def get_element_info(
    page_id: str,
    selector: str,
    timeout: int = 5000,
) -> Dict[str, Any]:
    """
    Get information about an element.

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the element
        timeout: Maximum time to wait for element in milliseconds

    Returns:
        Element information including visibility, attributes, bounding box
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "status": ActionStatus.ERROR.value,
            "errorMessage": f"Page not found: {page_id}",
        }

    try:
        element = page.locator(selector)

        # Wait for element to be attached
        await element.wait_for(state="attached", timeout=timeout)

        # Get element properties
        is_visible = await element.is_visible()
        is_enabled = await element.is_enabled()
        text_content = await element.text_content()
        inner_html = await element.inner_html()

        # Get bounding box
        bounding_box = await element.bounding_box()

        # Get tag name and attributes via evaluate
        element_data = await element.evaluate("""
            (el) => ({
                tagName: el.tagName.toLowerCase(),
                attributes: Object.fromEntries(
                    Array.from(el.attributes).map(attr => [attr.name, attr.value])
                ),
                isChecked: el.checked !== undefined ? el.checked : null,
            })
        """)

        return {
            "status": ActionStatus.SUCCESS.value,
            "selector": selector,
            "tagName": element_data.get("tagName"),
            "attributes": element_data.get("attributes", {}),
            "textContent": text_content,
            "innerHTML": inner_html[:500] if inner_html else None,
            "isVisible": is_visible,
            "isEnabled": is_enabled,
            "isChecked": element_data.get("isChecked"),
            "boundingBox": bounding_box,
            "timestamp": datetime.now().isoformat(),
        }

    except Exception as e:
        return {
            "status": ActionStatus.ERROR.value,
            "selector": selector,
            "errorMessage": str(e),
            "timestamp": datetime.now().isoformat(),
        }


async def get_locator_count(
    page_id: str,
    selector: str,
) -> Dict[str, Any]:
    """
    Get the number of elements matching a selector.

    Args:
        page_id: The page to search in
        selector: Playwright selector

    Returns:
        Count of matching elements
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "status": ActionStatus.ERROR.value,
            "errorMessage": f"Page not found: {page_id}",
        }

    try:
        count = await page.locator(selector).count()

        return {
            "status": ActionStatus.SUCCESS.value,
            "selector": selector,
            "count": count,
            "timestamp": datetime.now().isoformat(),
        }

    except Exception as e:
        return {
            "status": ActionStatus.ERROR.value,
            "selector": selector,
            "errorMessage": str(e),
            "timestamp": datetime.now().isoformat(),
        }
