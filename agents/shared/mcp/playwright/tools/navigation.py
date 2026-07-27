"""Navigation tools for Playwright MCP Server."""
import logging
import time
from datetime import datetime
from typing import Literal, Optional, Dict, Any

from ..context import get_browser_manager
from ..types import ActionResult, ActionStatus, NavigationResult

logger = logging.getLogger(__name__)


async def goto(
    page_id: str,
    url: str,
    wait_until: Literal["load", "domcontentloaded", "networkidle", "commit"] = "load",
    timeout: int = 30000,
    capture_before: bool = True,
    capture_after: bool = True,
) -> Dict[str, Any]:
    """
    Navigate to a URL.

    Args:
        page_id: The page to navigate
        url: The URL to navigate to
        wait_until: When to consider navigation complete
        timeout: Maximum time to wait in milliseconds
        capture_before: Capture screenshot before navigation
        capture_after: Capture screenshot after navigation

    Returns:
        Navigation result with status, screenshots, and timing
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "status": ActionStatus.ERROR.value,
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()
    screenshot_before = None
    screenshot_after = None

    try:
        # Capture before screenshot
        if capture_before and page.url != "about:blank":
            try:
                screenshot_before = await page.screenshot()
            except Exception:
                pass  # Page might not be ready

        # Navigate
        response = await page.goto(
            url,
            wait_until=wait_until,
            timeout=timeout,
        )

        # Capture after screenshot
        if capture_after:
            screenshot_after = await page.screenshot()

        duration_ms = int((time.time() - start_time) * 1000)

        # Get console logs collected during navigation
        page_state = manager.get_page_state(page_id)
        console_logs = []
        if page_state:
            console_logs = [
                {
                    "level": log.level,
                    "message": log.message,
                    "timestamp": log.timestamp.isoformat(),
                }
                for log in page_state.console_logs[-10:]  # Last 10 logs
            ]

        result = {
            "status": ActionStatus.SUCCESS.value,
            "actionType": "goto",
            "url": page.url,
            "title": await page.title(),
            "responseStatus": response.status if response else None,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
            "consoleLogs": console_logs,
        }

        # Include screenshot data if captured
        if screenshot_before:
            import base64
            result["screenshotBefore"] = base64.b64encode(screenshot_before).decode()
        if screenshot_after:
            import base64
            result["screenshotAfter"] = base64.b64encode(screenshot_after).decode()

        logger.info(f"Navigated to {url} in {duration_ms}ms")
        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)

        logger.error(f"Navigation failed: {error_msg}")

        return {
            "status": ActionStatus.TIMEOUT.value if "timeout" in error_msg.lower() else ActionStatus.ERROR.value,
            "actionType": "goto",
            "url": url,
            "errorMessage": error_msg,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def go_back(
    page_id: str,
    wait_until: Literal["load", "domcontentloaded", "networkidle", "commit"] = "load",
    timeout: int = 30000,
    capture_before: bool = True,
    capture_after: bool = True,
) -> Dict[str, Any]:
    """
    Navigate back in history.

    Args:
        page_id: The page to navigate
        wait_until: When to consider navigation complete
        timeout: Maximum time to wait in milliseconds
        capture_before: Capture screenshot before navigation
        capture_after: Capture screenshot after navigation

    Returns:
        Navigation result with status and timing
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
        screenshot_before = None
        screenshot_after = None

        if capture_before:
            screenshot_before = await page.screenshot()

        response = await page.go_back(
            wait_until=wait_until,
            timeout=timeout,
        )

        if capture_after:
            screenshot_after = await page.screenshot()

        duration_ms = int((time.time() - start_time) * 1000)

        result = {
            "status": ActionStatus.SUCCESS.value,
            "actionType": "goBack",
            "url": page.url,
            "title": await page.title(),
            "responseStatus": response.status if response else None,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if screenshot_before:
            import base64
            result["screenshotBefore"] = base64.b64encode(screenshot_before).decode()
        if screenshot_after:
            import base64
            result["screenshotAfter"] = base64.b64encode(screenshot_after).decode()

        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return {
            "status": ActionStatus.ERROR.value,
            "actionType": "goBack",
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def go_forward(
    page_id: str,
    wait_until: Literal["load", "domcontentloaded", "networkidle", "commit"] = "load",
    timeout: int = 30000,
    capture_before: bool = True,
    capture_after: bool = True,
) -> Dict[str, Any]:
    """
    Navigate forward in history.

    Args:
        page_id: The page to navigate
        wait_until: When to consider navigation complete
        timeout: Maximum time to wait in milliseconds
        capture_before: Capture screenshot before navigation
        capture_after: Capture screenshot after navigation

    Returns:
        Navigation result with status and timing
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
        screenshot_before = None
        screenshot_after = None

        if capture_before:
            screenshot_before = await page.screenshot()

        response = await page.go_forward(
            wait_until=wait_until,
            timeout=timeout,
        )

        if capture_after:
            screenshot_after = await page.screenshot()

        duration_ms = int((time.time() - start_time) * 1000)

        result = {
            "status": ActionStatus.SUCCESS.value,
            "actionType": "goForward",
            "url": page.url,
            "title": await page.title(),
            "responseStatus": response.status if response else None,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if screenshot_before:
            import base64
            result["screenshotBefore"] = base64.b64encode(screenshot_before).decode()
        if screenshot_after:
            import base64
            result["screenshotAfter"] = base64.b64encode(screenshot_after).decode()

        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return {
            "status": ActionStatus.ERROR.value,
            "actionType": "goForward",
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def reload(
    page_id: str,
    wait_until: Literal["load", "domcontentloaded", "networkidle", "commit"] = "load",
    timeout: int = 30000,
    capture_before: bool = True,
    capture_after: bool = True,
) -> Dict[str, Any]:
    """
    Reload the current page.

    Args:
        page_id: The page to reload
        wait_until: When to consider reload complete
        timeout: Maximum time to wait in milliseconds
        capture_before: Capture screenshot before reload
        capture_after: Capture screenshot after reload

    Returns:
        Reload result with status and timing
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
        screenshot_before = None
        screenshot_after = None

        if capture_before:
            screenshot_before = await page.screenshot()

        response = await page.reload(
            wait_until=wait_until,
            timeout=timeout,
        )

        if capture_after:
            screenshot_after = await page.screenshot()

        duration_ms = int((time.time() - start_time) * 1000)

        result = {
            "status": ActionStatus.SUCCESS.value,
            "actionType": "reload",
            "url": page.url,
            "title": await page.title(),
            "responseStatus": response.status if response else None,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if screenshot_before:
            import base64
            result["screenshotBefore"] = base64.b64encode(screenshot_before).decode()
        if screenshot_after:
            import base64
            result["screenshotAfter"] = base64.b64encode(screenshot_after).decode()

        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return {
            "status": ActionStatus.ERROR.value,
            "actionType": "reload",
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def get_current_url(page_id: str) -> Dict[str, Any]:
    """
    Get the current URL of the page.

    Args:
        page_id: The page to get URL from

    Returns:
        Dictionary with current URL
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "error": f"Page not found: {page_id}",
        }

    return {
        "url": page.url,
        "pageId": page_id,
    }


async def get_title(page_id: str) -> Dict[str, Any]:
    """
    Get the title of the page.

    Args:
        page_id: The page to get title from

    Returns:
        Dictionary with page title
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "error": f"Page not found: {page_id}",
        }

    return {
        "title": await page.title(),
        "pageId": page_id,
    }
