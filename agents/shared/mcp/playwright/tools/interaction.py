"""Interaction tools for Playwright MCP Server."""
import logging
import time
import base64
from datetime import datetime
from typing import Literal, Optional, Dict, Any, List

from ..context import get_browser_manager
from ..types import ActionStatus

logger = logging.getLogger(__name__)


async def click(
    page_id: str,
    selector: str,
    button: Literal["left", "right", "middle"] = "left",
    click_count: int = 1,
    timeout: int = 30000,
    force: bool = False,
    position_x: Optional[float] = None,
    position_y: Optional[float] = None,
    capture_before: bool = True,
    capture_after: bool = True,
) -> Dict[str, Any]:
    """
    Click an element.

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the element
        button: Mouse button to click (left, right, middle)
        click_count: Number of clicks (1 for single, 2 for double)
        timeout: Maximum time to wait for element in milliseconds
        force: Bypass actionability checks
        position_x: X offset relative to element center
        position_y: Y offset relative to element center
        capture_before: Capture screenshot before click
        capture_after: Capture screenshot after click

    Returns:
        Action result with status, screenshots, and timing
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
        if capture_before:
            screenshot_before = await page.screenshot()

        # Build position if specified
        position = None
        if position_x is not None and position_y is not None:
            position = {"x": position_x, "y": position_y}

        # Perform click
        await page.click(
            selector,
            button=button,
            click_count=click_count,
            timeout=timeout,
            force=force,
            position=position,
        )

        # Capture after screenshot
        if capture_after:
            screenshot_after = await page.screenshot()

        duration_ms = int((time.time() - start_time) * 1000)

        # Get console logs
        page_state = manager.get_page_state(page_id)
        console_logs = []
        if page_state:
            console_logs = [
                {
                    "level": log.level,
                    "message": log.message,
                    "timestamp": log.timestamp.isoformat(),
                }
                for log in page_state.console_logs[-5:]
            ]

        result = {
            "status": ActionStatus.SUCCESS.value,
            "actionType": "click",
            "selector": selector,
            "button": button,
            "clickCount": click_count,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
            "consoleLogs": console_logs,
        }

        if screenshot_before:
            result["screenshotBefore"] = base64.b64encode(screenshot_before).decode()
        if screenshot_after:
            result["screenshotAfter"] = base64.b64encode(screenshot_after).decode()

        logger.info(f"Clicked {selector} in {duration_ms}ms")
        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)

        logger.error(f"Click failed on {selector}: {error_msg}")

        return {
            "status": ActionStatus.TIMEOUT.value if "timeout" in error_msg.lower() else ActionStatus.ERROR.value,
            "actionType": "click",
            "selector": selector,
            "errorMessage": error_msg,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def fill(
    page_id: str,
    selector: str,
    value: str,
    timeout: int = 30000,
    force: bool = False,
    capture_before: bool = True,
    capture_after: bool = True,
) -> Dict[str, Any]:
    """
    Fill a text input with a value (clears existing content first).

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the input
        value: Text value to fill
        timeout: Maximum time to wait for element in milliseconds
        force: Bypass actionability checks
        capture_before: Capture screenshot before fill
        capture_after: Capture screenshot after fill

    Returns:
        Action result with status, screenshots, and timing
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
        if capture_before:
            screenshot_before = await page.screenshot()

        await page.fill(
            selector,
            value,
            timeout=timeout,
            force=force,
        )

        if capture_after:
            screenshot_after = await page.screenshot()

        duration_ms = int((time.time() - start_time) * 1000)

        result = {
            "status": ActionStatus.SUCCESS.value,
            "actionType": "fill",
            "selector": selector,
            "value": value[:50] + "..." if len(value) > 50 else value,  # Truncate for logging
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if screenshot_before:
            result["screenshotBefore"] = base64.b64encode(screenshot_before).decode()
        if screenshot_after:
            result["screenshotAfter"] = base64.b64encode(screenshot_after).decode()

        logger.info(f"Filled {selector} in {duration_ms}ms")
        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)

        return {
            "status": ActionStatus.TIMEOUT.value if "timeout" in error_msg.lower() else ActionStatus.ERROR.value,
            "actionType": "fill",
            "selector": selector,
            "errorMessage": error_msg,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def clear(
    page_id: str,
    selector: str,
    timeout: int = 30000,
    capture_before: bool = True,
    capture_after: bool = True,
) -> Dict[str, Any]:
    """
    Clear the contents of an input field.

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the input
        timeout: Maximum time to wait for element in milliseconds
        capture_before: Capture screenshot before clear
        capture_after: Capture screenshot after clear

    Returns:
        Action result with status and timing
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
        if capture_before:
            screenshot_before = await page.screenshot()

        await page.fill(selector, "", timeout=timeout)

        if capture_after:
            screenshot_after = await page.screenshot()

        duration_ms = int((time.time() - start_time) * 1000)

        result = {
            "status": ActionStatus.SUCCESS.value,
            "actionType": "clear",
            "selector": selector,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if screenshot_before:
            result["screenshotBefore"] = base64.b64encode(screenshot_before).decode()
        if screenshot_after:
            result["screenshotAfter"] = base64.b64encode(screenshot_after).decode()

        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return {
            "status": ActionStatus.ERROR.value,
            "actionType": "clear",
            "selector": selector,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def select_option(
    page_id: str,
    selector: str,
    value: Optional[str] = None,
    label: Optional[str] = None,
    index: Optional[int] = None,
    timeout: int = 30000,
    capture_before: bool = True,
    capture_after: bool = True,
) -> Dict[str, Any]:
    """
    Select an option from a dropdown/select element.

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the select element
        value: Option value attribute to select
        label: Option visible text to select
        index: Option index to select (0-based)
        timeout: Maximum time to wait for element in milliseconds
        capture_before: Capture screenshot before select
        capture_after: Capture screenshot after select

    Returns:
        Action result with selected values
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
        if capture_before:
            screenshot_before = await page.screenshot()

        # Select by value, label, or index
        if value is not None:
            selected = await page.select_option(selector, value=value, timeout=timeout)
        elif label is not None:
            selected = await page.select_option(selector, label=label, timeout=timeout)
        elif index is not None:
            selected = await page.select_option(selector, index=index, timeout=timeout)
        else:
            return {
                "status": ActionStatus.ERROR.value,
                "actionType": "selectOption",
                "selector": selector,
                "errorMessage": "Must provide value, label, or index",
            }

        if capture_after:
            screenshot_after = await page.screenshot()

        duration_ms = int((time.time() - start_time) * 1000)

        result = {
            "status": ActionStatus.SUCCESS.value,
            "actionType": "selectOption",
            "selector": selector,
            "selectedValues": selected,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if screenshot_before:
            result["screenshotBefore"] = base64.b64encode(screenshot_before).decode()
        if screenshot_after:
            result["screenshotAfter"] = base64.b64encode(screenshot_after).decode()

        logger.info(f"Selected option in {selector}: {selected}")
        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return {
            "status": ActionStatus.ERROR.value,
            "actionType": "selectOption",
            "selector": selector,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def check(
    page_id: str,
    selector: str,
    timeout: int = 30000,
    force: bool = False,
    capture_before: bool = True,
    capture_after: bool = True,
) -> Dict[str, Any]:
    """
    Check a checkbox or radio button.

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the checkbox
        timeout: Maximum time to wait for element in milliseconds
        force: Bypass actionability checks
        capture_before: Capture screenshot before check
        capture_after: Capture screenshot after check

    Returns:
        Action result with status
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
        if capture_before:
            screenshot_before = await page.screenshot()

        await page.check(selector, timeout=timeout, force=force)

        if capture_after:
            screenshot_after = await page.screenshot()

        duration_ms = int((time.time() - start_time) * 1000)

        result = {
            "status": ActionStatus.SUCCESS.value,
            "actionType": "check",
            "selector": selector,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if screenshot_before:
            result["screenshotBefore"] = base64.b64encode(screenshot_before).decode()
        if screenshot_after:
            result["screenshotAfter"] = base64.b64encode(screenshot_after).decode()

        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return {
            "status": ActionStatus.ERROR.value,
            "actionType": "check",
            "selector": selector,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def uncheck(
    page_id: str,
    selector: str,
    timeout: int = 30000,
    force: bool = False,
    capture_before: bool = True,
    capture_after: bool = True,
) -> Dict[str, Any]:
    """
    Uncheck a checkbox.

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the checkbox
        timeout: Maximum time to wait for element in milliseconds
        force: Bypass actionability checks
        capture_before: Capture screenshot before uncheck
        capture_after: Capture screenshot after uncheck

    Returns:
        Action result with status
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
        if capture_before:
            screenshot_before = await page.screenshot()

        await page.uncheck(selector, timeout=timeout, force=force)

        if capture_after:
            screenshot_after = await page.screenshot()

        duration_ms = int((time.time() - start_time) * 1000)

        result = {
            "status": ActionStatus.SUCCESS.value,
            "actionType": "uncheck",
            "selector": selector,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if screenshot_before:
            result["screenshotBefore"] = base64.b64encode(screenshot_before).decode()
        if screenshot_after:
            result["screenshotAfter"] = base64.b64encode(screenshot_after).decode()

        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return {
            "status": ActionStatus.ERROR.value,
            "actionType": "uncheck",
            "selector": selector,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def hover(
    page_id: str,
    selector: str,
    timeout: int = 30000,
    force: bool = False,
    position_x: Optional[float] = None,
    position_y: Optional[float] = None,
    capture_before: bool = True,
    capture_after: bool = True,
) -> Dict[str, Any]:
    """
    Hover over an element.

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the element
        timeout: Maximum time to wait for element in milliseconds
        force: Bypass actionability checks
        position_x: X offset relative to element center
        position_y: Y offset relative to element center
        capture_before: Capture screenshot before hover
        capture_after: Capture screenshot after hover

    Returns:
        Action result with status
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
        if capture_before:
            screenshot_before = await page.screenshot()

        position = None
        if position_x is not None and position_y is not None:
            position = {"x": position_x, "y": position_y}

        await page.hover(
            selector,
            timeout=timeout,
            force=force,
            position=position,
        )

        if capture_after:
            screenshot_after = await page.screenshot()

        duration_ms = int((time.time() - start_time) * 1000)

        result = {
            "status": ActionStatus.SUCCESS.value,
            "actionType": "hover",
            "selector": selector,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if screenshot_before:
            result["screenshotBefore"] = base64.b64encode(screenshot_before).decode()
        if screenshot_after:
            result["screenshotAfter"] = base64.b64encode(screenshot_after).decode()

        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return {
            "status": ActionStatus.ERROR.value,
            "actionType": "hover",
            "selector": selector,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def focus(
    page_id: str,
    selector: str,
    timeout: int = 30000,
) -> Dict[str, Any]:
    """
    Focus on an element.

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the element
        timeout: Maximum time to wait for element in milliseconds

    Returns:
        Action result with status
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
        await page.focus(selector, timeout=timeout)

        duration_ms = int((time.time() - start_time) * 1000)

        return {
            "status": ActionStatus.SUCCESS.value,
            "actionType": "focus",
            "selector": selector,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return {
            "status": ActionStatus.ERROR.value,
            "actionType": "focus",
            "selector": selector,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def press(
    page_id: str,
    selector: str,
    key: str,
    delay: int = 0,
    timeout: int = 30000,
    capture_before: bool = True,
    capture_after: bool = True,
) -> Dict[str, Any]:
    """
    Press a keyboard key while focused on an element.

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the element
        key: Key to press (e.g., "Enter", "Tab", "Escape", "a", "Control+a")
        delay: Time to wait between keydown and keyup in milliseconds
        timeout: Maximum time to wait for element in milliseconds
        capture_before: Capture screenshot before press
        capture_after: Capture screenshot after press

    Returns:
        Action result with status
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
        if capture_before:
            screenshot_before = await page.screenshot()

        await page.press(
            selector,
            key,
            delay=delay,
            timeout=timeout,
        )

        if capture_after:
            screenshot_after = await page.screenshot()

        duration_ms = int((time.time() - start_time) * 1000)

        result = {
            "status": ActionStatus.SUCCESS.value,
            "actionType": "press",
            "selector": selector,
            "key": key,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if screenshot_before:
            result["screenshotBefore"] = base64.b64encode(screenshot_before).decode()
        if screenshot_after:
            result["screenshotAfter"] = base64.b64encode(screenshot_after).decode()

        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return {
            "status": ActionStatus.ERROR.value,
            "actionType": "press",
            "selector": selector,
            "key": key,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }


async def type_text(
    page_id: str,
    selector: str,
    text: str,
    delay: int = 50,
    timeout: int = 30000,
    capture_before: bool = True,
    capture_after: bool = True,
) -> Dict[str, Any]:
    """
    Type text character by character (simulates real typing).

    Unlike fill(), this preserves existing content and types character by character.

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the element
        text: Text to type
        delay: Delay between keystrokes in milliseconds
        timeout: Maximum time to wait for element in milliseconds
        capture_before: Capture screenshot before typing
        capture_after: Capture screenshot after typing

    Returns:
        Action result with status
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
        if capture_before:
            screenshot_before = await page.screenshot()

        await page.type(
            selector,
            text,
            delay=delay,
            timeout=timeout,
        )

        if capture_after:
            screenshot_after = await page.screenshot()

        duration_ms = int((time.time() - start_time) * 1000)

        result = {
            "status": ActionStatus.SUCCESS.value,
            "actionType": "type",
            "selector": selector,
            "text": text[:50] + "..." if len(text) > 50 else text,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if screenshot_before:
            result["screenshotBefore"] = base64.b64encode(screenshot_before).decode()
        if screenshot_after:
            result["screenshotAfter"] = base64.b64encode(screenshot_after).decode()

        logger.info(f"Typed text in {selector} in {duration_ms}ms")
        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return {
            "status": ActionStatus.ERROR.value,
            "actionType": "type",
            "selector": selector,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }
