"""Browser lifecycle tools for Playwright MCP Server."""
import logging
from typing import Literal, Optional, Dict, Any

from ..context import get_browser_manager
from ..types import BrowserSession, ContextInfo, PageInfo

logger = logging.getLogger(__name__)


async def browser_launch(
    browser_type: Literal["chromium", "firefox", "webkit"] = "chromium",
    headless: bool = True,
    slow_mo: int = 0,
    viewport_width: int = 1280,
    viewport_height: int = 720,
) -> Dict[str, Any]:
    """
    Launch a new browser instance.

    Args:
        browser_type: Type of browser to launch (chromium, firefox, webkit)
        headless: Run browser in headless mode
        slow_mo: Slow down operations by specified milliseconds
        viewport_width: Default viewport width for new pages
        viewport_height: Default viewport height for new pages

    Returns:
        Dictionary with session information including session_id
    """
    manager = get_browser_manager()
    session = await manager.launch_browser(
        browser_type=browser_type,
        headless=headless,
        slow_mo=slow_mo,
        viewport_width=viewport_width,
        viewport_height=viewport_height,
    )

    logger.info(f"Browser launched: {session.session_id}")

    return {
        "sessionId": session.session_id,
        "browserType": session.browser_type,
        "headless": session.headless,
        "viewportWidth": session.viewport_width,
        "viewportHeight": session.viewport_height,
        "createdAt": session.created_at.isoformat(),
    }


async def browser_close(session_id: str) -> Dict[str, Any]:
    """
    Close a browser session and cleanup all resources.

    Args:
        session_id: The ID of the browser session to close

    Returns:
        Dictionary indicating success/failure
    """
    manager = get_browser_manager()
    success = await manager.close_browser(session_id)

    return {
        "success": success,
        "sessionId": session_id,
        "message": "Browser closed successfully" if success else "Failed to close browser",
    }


async def context_create(
    session_id: str,
    storage_state: Optional[str] = None,
    locale: str = "en-US",
    timezone: str = "America/New_York",
    record_video: Optional[bool] = None,
    video_dir: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create a new browser context within a session.

    Browser contexts are isolated environments within a browser session.
    They have separate cookies, localStorage, and cache.

    Args:
        session_id: The browser session to create context in
        storage_state: Path to saved storage state (cookies, localStorage) for auth
        locale: Browser locale (e.g., "en-US", "fr-FR")
        timezone: Browser timezone (e.g., "America/New_York")
        record_video: Whether to record video (defaults to config setting)
        video_dir: Directory to save videos (defaults to config setting)

    Returns:
        Dictionary with context information including context_id
    """
    manager = get_browser_manager()

    try:
        context = await manager.create_context(
            session_id=session_id,
            storage_state=storage_state,
            locale=locale,
            timezone=timezone,
            record_video=record_video,
            video_dir=video_dir,
        )

        logger.info(f"Context created: {context.context_id}")

        return {
            "contextId": context.context_id,
            "sessionId": context.session_id,
            "locale": context.locale,
            "timezone": context.timezone,
            "createdAt": context.created_at.isoformat(),
        }
    except ValueError as e:
        return {
            "error": str(e),
            "sessionId": session_id,
        }


async def context_close(context_id: str) -> Dict[str, Any]:
    """
    Close a browser context.

    Args:
        context_id: The ID of the context to close

    Returns:
        Dictionary indicating success/failure
    """
    manager = get_browser_manager()
    success = await manager.close_context(context_id)

    return {
        "success": success,
        "contextId": context_id,
        "message": "Context closed successfully" if success else "Failed to close context",
    }


async def page_create(context_id: str) -> Dict[str, Any]:
    """
    Create a new page (tab) within a browser context.

    Args:
        context_id: The context to create the page in

    Returns:
        Dictionary with page information including page_id
    """
    manager = get_browser_manager()

    try:
        page = await manager.create_page(context_id=context_id)

        logger.info(f"Page created: {page.page_id}")

        return {
            "pageId": page.page_id,
            "contextId": page.context_id,
            "url": page.url,
            "title": page.title,
            "createdAt": page.created_at.isoformat(),
        }
    except ValueError as e:
        return {
            "error": str(e),
            "contextId": context_id,
        }


async def page_close(page_id: str) -> Dict[str, Any]:
    """
    Close a page (tab).

    Args:
        page_id: The ID of the page to close

    Returns:
        Dictionary indicating success/failure, with videoPath if a recording was captured
    """
    manager = get_browser_manager()
    result = await manager.close_page(page_id)

    return {
        "success": result.get("success", False),
        "pageId": page_id,
        "message": "Page closed successfully" if result.get("success") else "Failed to close page",
        **({"videoPath": result["videoPath"]} if "videoPath" in result else {}),
    }


async def get_session_info(session_id: str) -> Dict[str, Any]:
    """
    Get information about a browser session.

    Args:
        session_id: The ID of the session

    Returns:
        Dictionary with session details or error
    """
    manager = get_browser_manager()
    session = manager.get_session(session_id)

    if not session:
        return {
            "error": f"Session not found: {session_id}",
        }

    return {
        "sessionId": session.info.session_id,
        "browserType": session.info.browser_type,
        "headless": session.info.headless,
        "viewportWidth": session.info.viewport_width,
        "viewportHeight": session.info.viewport_height,
        "contextCount": len(session.contexts),
        "contexts": [
            {
                "contextId": ctx.info.context_id,
                "pageCount": len(ctx.pages),
            }
            for ctx in session.contexts.values()
        ],
    }
