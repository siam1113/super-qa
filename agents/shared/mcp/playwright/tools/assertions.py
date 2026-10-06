"""Assertion tools for Playwright MCP Server."""
import logging
import time
import base64
import re
from datetime import datetime
from typing import Optional, Dict, Any

from playwright.async_api import expect

from ..context import get_browser_manager
from ..types import ActionStatus

logger = logging.getLogger(__name__)


async def expect_visible(
    page_id: str,
    selector: str,
    timeout: int = 5000,
    capture_screenshot: bool = True,
) -> Dict[str, Any]:
    """
    Assert that an element is visible.

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the element
        timeout: Maximum time to wait in milliseconds
        capture_screenshot: Capture screenshot with result

    Returns:
        Assertion result with pass/fail status
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "passed": False,
            "status": ActionStatus.ERROR.value,
            "assertionType": "visible",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        element = page.locator(selector)
        await expect(element).to_be_visible(timeout=timeout)

        duration_ms = int((time.time() - start_time) * 1000)

        result = {
            "passed": True,
            "status": ActionStatus.SUCCESS.value,
            "assertionType": "visible",
            "selector": selector,
            "expected": "visible",
            "actual": "visible",
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            screenshot = await page.screenshot()
            result["screenshot"] = base64.b64encode(screenshot).decode()

        logger.info(f"Assert visible passed: {selector}")
        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)

        result = {
            "passed": False,
            "status": ActionStatus.FAILED.value,
            "assertionType": "visible",
            "selector": selector,
            "expected": "visible",
            "actual": "not visible or not found",
            "errorMessage": error_msg,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            try:
                screenshot = await page.screenshot()
                result["screenshot"] = base64.b64encode(screenshot).decode()
            except Exception:
                pass

        logger.warning(f"Assert visible failed: {selector}")
        return result


async def expect_hidden(
    page_id: str,
    selector: str,
    timeout: int = 5000,
    capture_screenshot: bool = True,
) -> Dict[str, Any]:
    """
    Assert that an element is hidden or not in DOM.

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the element
        timeout: Maximum time to wait in milliseconds
        capture_screenshot: Capture screenshot with result

    Returns:
        Assertion result with pass/fail status
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "passed": False,
            "status": ActionStatus.ERROR.value,
            "assertionType": "hidden",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        element = page.locator(selector)
        await expect(element).to_be_hidden(timeout=timeout)

        duration_ms = int((time.time() - start_time) * 1000)

        result = {
            "passed": True,
            "status": ActionStatus.SUCCESS.value,
            "assertionType": "hidden",
            "selector": selector,
            "expected": "hidden",
            "actual": "hidden",
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            screenshot = await page.screenshot()
            result["screenshot"] = base64.b64encode(screenshot).decode()

        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)

        result = {
            "passed": False,
            "status": ActionStatus.FAILED.value,
            "assertionType": "hidden",
            "selector": selector,
            "expected": "hidden",
            "actual": "visible",
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            try:
                screenshot = await page.screenshot()
                result["screenshot"] = base64.b64encode(screenshot).decode()
            except Exception:
                pass

        return result


async def expect_text(
    page_id: str,
    selector: str,
    expected_text: str,
    exact: bool = False,
    ignore_case: bool = False,
    timeout: int = 5000,
    capture_screenshot: bool = True,
) -> Dict[str, Any]:
    """
    Assert that an element contains expected text.

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the element
        expected_text: Text to expect (substring match by default)
        exact: Require exact match instead of substring
        ignore_case: Case-insensitive comparison
        timeout: Maximum time to wait in milliseconds
        capture_screenshot: Capture screenshot with result

    Returns:
        Assertion result with expected/actual values
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "passed": False,
            "status": ActionStatus.ERROR.value,
            "assertionType": "text",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        element = page.locator(selector)

        if exact:
            await expect(element).to_have_text(
                expected_text,
                timeout=timeout,
                ignore_case=ignore_case,
            )
        else:
            await expect(element).to_contain_text(
                expected_text,
                timeout=timeout,
                ignore_case=ignore_case,
            )

        duration_ms = int((time.time() - start_time) * 1000)
        actual_text = await element.text_content()

        result = {
            "passed": True,
            "status": ActionStatus.SUCCESS.value,
            "assertionType": "text",
            "selector": selector,
            "expected": expected_text,
            "actual": actual_text,
            "exact": exact,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            screenshot = await page.screenshot()
            result["screenshot"] = base64.b64encode(screenshot).decode()

        logger.info(f"Assert text passed: {selector} = '{expected_text}'")
        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        actual_text = None

        try:
            element = page.locator(selector)
            actual_text = await element.text_content()
        except Exception:
            pass

        result = {
            "passed": False,
            "status": ActionStatus.FAILED.value,
            "assertionType": "text",
            "selector": selector,
            "expected": expected_text,
            "actual": actual_text,
            "exact": exact,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            try:
                screenshot = await page.screenshot()
                result["screenshot"] = base64.b64encode(screenshot).decode()
            except Exception:
                pass

        logger.warning(f"Assert text failed: {selector}")
        return result


async def expect_value(
    page_id: str,
    selector: str,
    expected_value: str,
    timeout: int = 5000,
    capture_screenshot: bool = True,
) -> Dict[str, Any]:
    """
    Assert that an input element has expected value.

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the input element
        expected_value: Expected value of the input
        timeout: Maximum time to wait in milliseconds
        capture_screenshot: Capture screenshot with result

    Returns:
        Assertion result with expected/actual values
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "passed": False,
            "status": ActionStatus.ERROR.value,
            "assertionType": "value",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        element = page.locator(selector)
        await expect(element).to_have_value(expected_value, timeout=timeout)

        duration_ms = int((time.time() - start_time) * 1000)
        actual_value = await element.input_value()

        result = {
            "passed": True,
            "status": ActionStatus.SUCCESS.value,
            "assertionType": "value",
            "selector": selector,
            "expected": expected_value,
            "actual": actual_value,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            screenshot = await page.screenshot()
            result["screenshot"] = base64.b64encode(screenshot).decode()

        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        actual_value = None

        try:
            element = page.locator(selector)
            actual_value = await element.input_value()
        except Exception:
            pass

        result = {
            "passed": False,
            "status": ActionStatus.FAILED.value,
            "assertionType": "value",
            "selector": selector,
            "expected": expected_value,
            "actual": actual_value,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            try:
                screenshot = await page.screenshot()
                result["screenshot"] = base64.b64encode(screenshot).decode()
            except Exception:
                pass

        return result


async def expect_url(
    page_id: str,
    url_pattern: str,
    timeout: int = 5000,
    capture_screenshot: bool = True,
) -> Dict[str, Any]:
    """
    Assert that the page URL matches a pattern.

    Args:
        page_id: The page to check
        url_pattern: URL pattern (can be regex)
        timeout: Maximum time to wait in milliseconds
        capture_screenshot: Capture screenshot with result

    Returns:
        Assertion result with expected/actual URLs
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "passed": False,
            "status": ActionStatus.ERROR.value,
            "assertionType": "url",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        # Try as regex first
        try:
            pattern = re.compile(url_pattern)
            await expect(page).to_have_url(pattern, timeout=timeout)
        except re.error:
            # Fall back to string match
            await expect(page).to_have_url(url_pattern, timeout=timeout)

        duration_ms = int((time.time() - start_time) * 1000)

        result = {
            "passed": True,
            "status": ActionStatus.SUCCESS.value,
            "assertionType": "url",
            "expected": url_pattern,
            "actual": page.url,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            screenshot = await page.screenshot()
            result["screenshot"] = base64.b64encode(screenshot).decode()

        logger.info(f"Assert URL passed: {url_pattern}")
        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)

        result = {
            "passed": False,
            "status": ActionStatus.FAILED.value,
            "assertionType": "url",
            "expected": url_pattern,
            "actual": page.url,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            try:
                screenshot = await page.screenshot()
                result["screenshot"] = base64.b64encode(screenshot).decode()
            except Exception:
                pass

        logger.warning(f"Assert URL failed: expected {url_pattern}, got {page.url}")
        return result


async def expect_title(
    page_id: str,
    title_pattern: str,
    timeout: int = 5000,
    capture_screenshot: bool = True,
) -> Dict[str, Any]:
    """
    Assert that the page title matches a pattern.

    Args:
        page_id: The page to check
        title_pattern: Title pattern (can be regex)
        timeout: Maximum time to wait in milliseconds
        capture_screenshot: Capture screenshot with result

    Returns:
        Assertion result with expected/actual titles
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "passed": False,
            "status": ActionStatus.ERROR.value,
            "assertionType": "title",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        # Try as regex first
        try:
            pattern = re.compile(title_pattern)
            await expect(page).to_have_title(pattern, timeout=timeout)
        except re.error:
            # Fall back to string match
            await expect(page).to_have_title(title_pattern, timeout=timeout)

        duration_ms = int((time.time() - start_time) * 1000)
        actual_title = await page.title()

        result = {
            "passed": True,
            "status": ActionStatus.SUCCESS.value,
            "assertionType": "title",
            "expected": title_pattern,
            "actual": actual_title,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            screenshot = await page.screenshot()
            result["screenshot"] = base64.b64encode(screenshot).decode()

        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        actual_title = await page.title()

        result = {
            "passed": False,
            "status": ActionStatus.FAILED.value,
            "assertionType": "title",
            "expected": title_pattern,
            "actual": actual_title,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            try:
                screenshot = await page.screenshot()
                result["screenshot"] = base64.b64encode(screenshot).decode()
            except Exception:
                pass

        return result


async def expect_element_count(
    page_id: str,
    selector: str,
    expected_count: int,
    timeout: int = 5000,
    capture_screenshot: bool = True,
) -> Dict[str, Any]:
    """
    Assert the number of elements matching a selector.

    Args:
        page_id: The page to search in
        selector: Playwright selector
        expected_count: Expected number of matching elements
        timeout: Maximum time to wait in milliseconds
        capture_screenshot: Capture screenshot with result

    Returns:
        Assertion result with expected/actual counts
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "passed": False,
            "status": ActionStatus.ERROR.value,
            "assertionType": "elementCount",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        element = page.locator(selector)
        await expect(element).to_have_count(expected_count, timeout=timeout)

        duration_ms = int((time.time() - start_time) * 1000)
        actual_count = await element.count()

        result = {
            "passed": True,
            "status": ActionStatus.SUCCESS.value,
            "assertionType": "elementCount",
            "selector": selector,
            "expected": expected_count,
            "actual": actual_count,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            screenshot = await page.screenshot()
            result["screenshot"] = base64.b64encode(screenshot).decode()

        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        actual_count = None

        try:
            actual_count = await page.locator(selector).count()
        except Exception:
            pass

        result = {
            "passed": False,
            "status": ActionStatus.FAILED.value,
            "assertionType": "elementCount",
            "selector": selector,
            "expected": expected_count,
            "actual": actual_count,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            try:
                screenshot = await page.screenshot()
                result["screenshot"] = base64.b64encode(screenshot).decode()
            except Exception:
                pass

        return result


async def expect_checked(
    page_id: str,
    selector: str,
    checked: bool = True,
    timeout: int = 5000,
    capture_screenshot: bool = True,
) -> Dict[str, Any]:
    """
    Assert that a checkbox/radio is checked or unchecked.

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the checkbox
        checked: Expected checked state
        timeout: Maximum time to wait in milliseconds
        capture_screenshot: Capture screenshot with result

    Returns:
        Assertion result with expected/actual state
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "passed": False,
            "status": ActionStatus.ERROR.value,
            "assertionType": "checked",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        element = page.locator(selector)

        if checked:
            await expect(element).to_be_checked(timeout=timeout)
        else:
            await expect(element).not_to_be_checked(timeout=timeout)

        duration_ms = int((time.time() - start_time) * 1000)
        actual_checked = await element.is_checked()

        result = {
            "passed": True,
            "status": ActionStatus.SUCCESS.value,
            "assertionType": "checked",
            "selector": selector,
            "expected": checked,
            "actual": actual_checked,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            screenshot = await page.screenshot()
            result["screenshot"] = base64.b64encode(screenshot).decode()

        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        actual_checked = None

        try:
            actual_checked = await page.locator(selector).is_checked()
        except Exception:
            pass

        result = {
            "passed": False,
            "status": ActionStatus.FAILED.value,
            "assertionType": "checked",
            "selector": selector,
            "expected": checked,
            "actual": actual_checked,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            try:
                screenshot = await page.screenshot()
                result["screenshot"] = base64.b64encode(screenshot).decode()
            except Exception:
                pass

        return result


async def expect_enabled(
    page_id: str,
    selector: str,
    enabled: bool = True,
    timeout: int = 5000,
    capture_screenshot: bool = True,
) -> Dict[str, Any]:
    """
    Assert that an element is enabled or disabled.

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the element
        enabled: Expected enabled state
        timeout: Maximum time to wait in milliseconds
        capture_screenshot: Capture screenshot with result

    Returns:
        Assertion result with expected/actual state
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "passed": False,
            "status": ActionStatus.ERROR.value,
            "assertionType": "enabled",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        element = page.locator(selector)

        if enabled:
            await expect(element).to_be_enabled(timeout=timeout)
        else:
            await expect(element).to_be_disabled(timeout=timeout)

        duration_ms = int((time.time() - start_time) * 1000)
        actual_enabled = await element.is_enabled()

        result = {
            "passed": True,
            "status": ActionStatus.SUCCESS.value,
            "assertionType": "enabled",
            "selector": selector,
            "expected": enabled,
            "actual": actual_enabled,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            screenshot = await page.screenshot()
            result["screenshot"] = base64.b64encode(screenshot).decode()

        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        actual_enabled = None

        try:
            actual_enabled = await page.locator(selector).is_enabled()
        except Exception:
            pass

        result = {
            "passed": False,
            "status": ActionStatus.FAILED.value,
            "assertionType": "enabled",
            "selector": selector,
            "expected": enabled,
            "actual": actual_enabled,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            try:
                screenshot = await page.screenshot()
                result["screenshot"] = base64.b64encode(screenshot).decode()
            except Exception:
                pass

        return result


async def expect_attribute(
    page_id: str,
    selector: str,
    attribute: str,
    expected_value: Optional[str] = None,
    timeout: int = 5000,
    capture_screenshot: bool = True,
) -> Dict[str, Any]:
    """
    Assert that an element has an attribute with expected value.

    Args:
        page_id: The page containing the element
        selector: Playwright selector to find the element
        attribute: Attribute name to check
        expected_value: Expected attribute value (None to just check existence)
        timeout: Maximum time to wait in milliseconds
        capture_screenshot: Capture screenshot with result

    Returns:
        Assertion result with expected/actual values
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "passed": False,
            "status": ActionStatus.ERROR.value,
            "assertionType": "attribute",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    try:
        element = page.locator(selector)

        if expected_value is not None:
            await expect(element).to_have_attribute(
                attribute,
                expected_value,
                timeout=timeout,
            )
        else:
            # Just check that attribute exists
            actual_value = await element.get_attribute(attribute)
            if actual_value is None:
                raise AssertionError(f"Attribute '{attribute}' not found")

        duration_ms = int((time.time() - start_time) * 1000)
        actual_value = await element.get_attribute(attribute)

        result = {
            "passed": True,
            "status": ActionStatus.SUCCESS.value,
            "assertionType": "attribute",
            "selector": selector,
            "attribute": attribute,
            "expected": expected_value,
            "actual": actual_value,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            screenshot = await page.screenshot()
            result["screenshot"] = base64.b64encode(screenshot).decode()

        return result

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        actual_value = None

        try:
            actual_value = await page.locator(selector).get_attribute(attribute)
        except Exception:
            pass

        result = {
            "passed": False,
            "status": ActionStatus.FAILED.value,
            "assertionType": "attribute",
            "selector": selector,
            "attribute": attribute,
            "expected": expected_value,
            "actual": actual_value,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

        if capture_screenshot:
            try:
                screenshot = await page.screenshot()
                result["screenshot"] = base64.b64encode(screenshot).decode()
            except Exception:
                pass

        return result


async def expect_download(
    page_id: str,
    filename_pattern: Optional[str] = None,
    timeout: int = 5000,
) -> Dict[str, Any]:
    """
    Assert that a file download occurred (optionally matching a filename pattern).

    Checks downloads already captured on this page (BrowserManager records every
    download via a page.on("download") listener) and, if none match yet, waits up
    to `timeout` for one to occur.

    Args:
        page_id: The page to check for downloads
        filename_pattern: Optional regex (falls back to substring match) against
            the download's suggested filename; omit to accept any download
        timeout: Maximum additional time to wait for a new download, in milliseconds

    Returns:
        Assertion result with pass/fail status
    """
    manager = get_browser_manager()
    page = manager.get_page(page_id)

    if not page:
        return {
            "passed": False,
            "status": ActionStatus.ERROR.value,
            "assertionType": "download",
            "errorMessage": f"Page not found: {page_id}",
        }

    start_time = time.time()

    def _matches(filename: str) -> bool:
        if not filename_pattern:
            return True
        try:
            return bool(re.search(filename_pattern, filename))
        except re.error:
            return filename_pattern in filename

    existing = [d for d in manager.get_downloads(page_id) if _matches(d.suggested_filename)]
    if existing:
        match = existing[-1]
        return {
            "passed": True,
            "status": ActionStatus.SUCCESS.value,
            "assertionType": "download",
            "expected": filename_pattern or "any file",
            "actual": match.suggested_filename,
            "url": match.url,
            "durationMs": 0,
            "timestamp": datetime.now().isoformat(),
        }

    try:
        download = await page.wait_for_event(
            "download",
            predicate=(lambda d: _matches(d.suggested_filename)) if filename_pattern else None,
            timeout=timeout,
        )
        duration_ms = int((time.time() - start_time) * 1000)

        logger.info(f"Assert download passed: {download.suggested_filename}")
        return {
            "passed": True,
            "status": ActionStatus.SUCCESS.value,
            "assertionType": "download",
            "expected": filename_pattern or "any file",
            "actual": download.suggested_filename,
            "url": download.url,
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)

        logger.warning(f"Assert download failed: {e}")
        return {
            "passed": False,
            "status": ActionStatus.FAILED.value,
            "assertionType": "download",
            "expected": filename_pattern or "any file",
            "actual": None,
            "errorMessage": str(e),
            "durationMs": duration_ms,
            "timestamp": datetime.now().isoformat(),
        }
