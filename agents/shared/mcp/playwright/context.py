"""Browser context and session management for Playwright MCP Server."""
import asyncio
import uuid
import logging
from datetime import datetime
from typing import Dict, Optional, List, Literal
from dataclasses import dataclass, field

from playwright.async_api import (
    async_playwright,
    Playwright,
    Browser,
    BrowserContext,
    Page,
    ConsoleMessage,
    Request,
    Response,
)

from .types import (
    BrowserSession,
    ContextInfo,
    PageInfo,
    ConsoleLog,
    NetworkRequest,
    PlaywrightConfig,
    VideoResult,
)

logger = logging.getLogger(__name__)


@dataclass
class PageState:
    """Tracks state for an individual page."""
    page: Page
    info: PageInfo
    console_logs: List[ConsoleLog] = field(default_factory=list)
    network_requests: List[NetworkRequest] = field(default_factory=list)
    _request_map: Dict[str, NetworkRequest] = field(default_factory=dict)
    video_path: Optional[str] = None


@dataclass
class ContextState:
    """Tracks state for a browser context."""
    context: BrowserContext
    info: ContextInfo
    pages: Dict[str, PageState] = field(default_factory=dict)
    video_dir: Optional[str] = None


@dataclass
class SessionState:
    """Tracks state for a browser session."""
    browser: Browser
    info: BrowserSession
    contexts: Dict[str, ContextState] = field(default_factory=dict)


class BrowserManager:
    """Manages browser sessions, contexts, and pages with event tracking."""

    def __init__(self, config: PlaywrightConfig):
        self.config = config
        self._playwright: Optional[Playwright] = None
        self._sessions: Dict[str, SessionState] = {}
        self._lock = asyncio.Lock()

    async def initialize(self) -> None:
        """Initialize the Playwright instance."""
        if self._playwright is None:
            self._playwright = await async_playwright().start()
            logger.info("Playwright initialized")

    async def shutdown(self) -> None:
        """Shutdown all browsers and cleanup."""
        async with self._lock:
            for session_id in list(self._sessions.keys()):
                await self._close_session(session_id)

            if self._playwright:
                await self._playwright.stop()
                self._playwright = None

            logger.info("Playwright shutdown complete")

    async def launch_browser(
        self,
        browser_type: Literal["chromium", "firefox", "webkit"] = "chromium",
        headless: Optional[bool] = None,
        slow_mo: Optional[int] = None,
        viewport_width: Optional[int] = None,
        viewport_height: Optional[int] = None,
    ) -> BrowserSession:
        """Launch a new browser instance."""
        await self.initialize()

        headless = headless if headless is not None else self.config.headless
        slow_mo = slow_mo if slow_mo is not None else self.config.slow_mo
        viewport_width = viewport_width or self.config.viewport_width
        viewport_height = viewport_height or self.config.viewport_height

        async with self._lock:
            browser_launcher = getattr(self._playwright, browser_type)
            browser = await browser_launcher.launch(
                headless=headless,
                slow_mo=slow_mo,
            )

            session_id = f"session-{uuid.uuid4().hex[:12]}"
            session_info = BrowserSession(
                session_id=session_id,
                browser_type=browser_type,
                headless=headless,
                viewport_width=viewport_width,
                viewport_height=viewport_height,
            )

            self._sessions[session_id] = SessionState(
                browser=browser,
                info=session_info,
            )

            logger.info(f"Launched {browser_type} browser: {session_id}")
            return session_info

    async def close_browser(self, session_id: str) -> bool:
        """Close a browser session."""
        async with self._lock:
            return await self._close_session(session_id)

    async def _close_session(self, session_id: str) -> bool:
        """Internal method to close a session."""
        session = self._sessions.get(session_id)
        if not session:
            return False

        try:
            await session.browser.close()
            del self._sessions[session_id]
            logger.info(f"Closed browser session: {session_id}")
            return True
        except Exception as e:
            logger.error(f"Error closing session {session_id}: {e}")
            return False

    async def create_context(
        self,
        session_id: str,
        storage_state: Optional[str] = None,
        locale: str = "en-US",
        timezone: str = "America/New_York",
        record_video: Optional[bool] = None,
        video_dir: Optional[str] = None,
    ) -> ContextInfo:
        """Create a new browser context within a session.

        Args:
            session_id: The browser session to create context in
            storage_state: Path to saved storage state for auth
            locale: Browser locale
            timezone: Browser timezone
            record_video: Whether to record video (defaults to config setting)
            video_dir: Directory to save videos (defaults to config setting)
        """
        session = self._sessions.get(session_id)
        if not session:
            raise ValueError(f"Session not found: {session_id}")

        # Determine video settings
        should_record = record_video if record_video is not None else self.config.capture_video
        video_path = video_dir or self.config.video_dir

        # Ensure video directory exists
        if should_record:
            import os
            os.makedirs(video_path, exist_ok=True)

        # Build context options
        context_options = {
            "viewport": {
                "width": session.info.viewport_width,
                "height": session.info.viewport_height,
            },
            "locale": locale,
            "timezone_id": timezone,
        }

        if storage_state:
            context_options["storage_state"] = storage_state

        # Add video recording options
        if should_record:
            context_options["record_video_dir"] = video_path
            if self.config.video_size:
                context_options["record_video_size"] = self.config.video_size
            else:
                context_options["record_video_size"] = {
                    "width": session.info.viewport_width,
                    "height": session.info.viewport_height,
                }

        context = await session.browser.new_context(**context_options)

        context_id = f"ctx-{uuid.uuid4().hex[:12]}"
        context_info = ContextInfo(
            context_id=context_id,
            session_id=session_id,
            storage_state=storage_state,
            locale=locale,
            timezone=timezone,
            video_enabled=should_record,
            video_dir=video_path if should_record else None,
        )

        session.contexts[context_id] = ContextState(
            context=context,
            info=context_info,
            video_dir=video_path if should_record else None,
        )

        logger.info(f"Created context {context_id} in session {session_id} (video: {should_record})")
        return context_info

    async def close_context(self, context_id: str) -> bool:
        """Close a browser context."""
        for session in self._sessions.values():
            if context_id in session.contexts:
                context_state = session.contexts[context_id]
                try:
                    await context_state.context.close()
                    del session.contexts[context_id]
                    logger.info(f"Closed context: {context_id}")
                    return True
                except Exception as e:
                    logger.error(f"Error closing context {context_id}: {e}")
                    return False
        return False

    async def create_page(self, context_id: str) -> PageInfo:
        """Create a new page/tab in a context."""
        context_state = self._find_context(context_id)
        if not context_state:
            raise ValueError(f"Context not found: {context_id}")

        page = await context_state.context.new_page()
        page_id = f"page-{uuid.uuid4().hex[:12]}"

        page_info = PageInfo(
            page_id=page_id,
            context_id=context_id,
        )

        page_state = PageState(page=page, info=page_info)
        context_state.pages[page_id] = page_state

        # Set up event listeners for console and network
        if self.config.capture_console_logs:
            page.on("console", lambda msg: self._on_console(page_id, msg))

        if self.config.capture_network:
            page.on("request", lambda req: self._on_request(page_id, req))
            page.on("response", lambda res: self._on_response(page_id, res))

        logger.info(f"Created page {page_id} in context {context_id}")
        return page_info

    async def close_page(self, page_id: str, save_video: bool = True) -> Dict[str, Any]:
        """Close a page/tab and optionally save video.

        Returns:
            Dictionary with success status and video path if recorded
        """
        page_state = self._find_page(page_id)
        if not page_state:
            return {"success": False, "error": "Page not found"}

        result = {"success": True, "pageId": page_id}

        try:
            # Save video path before closing if video was recorded
            if save_video:
                video = page_state.page.video
                if video:
                    try:
                        video_path = await video.path()
                        result["videoPath"] = str(video_path)
                        page_state.video_path = str(video_path)
                        logger.info(f"Video saved for page {page_id}: {video_path}")
                    except Exception as ve:
                        logger.warning(f"Could not get video path: {ve}")

            await page_state.page.close()

            # Remove from parent context
            for session in self._sessions.values():
                for context in session.contexts.values():
                    if page_id in context.pages:
                        del context.pages[page_id]
                        break

            logger.info(f"Closed page: {page_id}")
            return result

        except Exception as e:
            logger.error(f"Error closing page {page_id}: {e}")
            return {"success": False, "error": str(e), "pageId": page_id}

    def get_page(self, page_id: str) -> Optional[Page]:
        """Get the Playwright Page object for a page ID."""
        page_state = self._find_page(page_id)
        return page_state.page if page_state else None

    def get_page_state(self, page_id: str) -> Optional[PageState]:
        """Get the full page state including logs."""
        return self._find_page(page_id)

    def get_context(self, context_id: str) -> Optional[BrowserContext]:
        """Get the Playwright BrowserContext for a context ID."""
        context_state = self._find_context(context_id)
        return context_state.context if context_state else None

    def get_session(self, session_id: str) -> Optional[SessionState]:
        """Get a session by ID."""
        return self._sessions.get(session_id)

    def get_console_logs(self, page_id: str, clear: bool = False) -> List[ConsoleLog]:
        """Get console logs for a page."""
        page_state = self._find_page(page_id)
        if not page_state:
            return []

        logs = list(page_state.console_logs)
        if clear:
            page_state.console_logs.clear()
        return logs

    def get_network_requests(
        self,
        page_id: str,
        url_filter: Optional[str] = None,
        clear: bool = False,
    ) -> List[NetworkRequest]:
        """Get network requests for a page."""
        page_state = self._find_page(page_id)
        if not page_state:
            return []

        requests = list(page_state.network_requests)
        if url_filter:
            requests = [r for r in requests if url_filter in r.url]

        if clear:
            page_state.network_requests.clear()
            page_state._request_map.clear()

        return requests

    def clear_logs(self, page_id: str) -> None:
        """Clear all captured logs for a page."""
        page_state = self._find_page(page_id)
        if page_state:
            page_state.console_logs.clear()
            page_state.network_requests.clear()
            page_state._request_map.clear()

    def _find_context(self, context_id: str) -> Optional[ContextState]:
        """Find a context across all sessions."""
        for session in self._sessions.values():
            if context_id in session.contexts:
                return session.contexts[context_id]
        return None

    def _find_page(self, page_id: str) -> Optional[PageState]:
        """Find a page across all sessions and contexts."""
        for session in self._sessions.values():
            for context in session.contexts.values():
                if page_id in context.pages:
                    return context.pages[page_id]
        return None

    def _on_console(self, page_id: str, message: ConsoleMessage) -> None:
        """Handle console message events."""
        page_state = self._find_page(page_id)
        if not page_state:
            return

        log = ConsoleLog(
            level=message.type,
            message=message.text,
            source=message.location.get("url") if message.location else None,
            line_number=message.location.get("lineNumber") if message.location else None,
            args=[str(arg) for arg in message.args],
        )
        page_state.console_logs.append(log)

    def _on_request(self, page_id: str, request: Request) -> None:
        """Handle network request events."""
        page_state = self._find_page(page_id)
        if not page_state:
            return

        req = NetworkRequest(
            url=request.url,
            method=request.method,
            request_headers=dict(request.headers),
            resource_type=request.resource_type,
        )

        # Store by URL for matching with response
        page_state._request_map[request.url] = req

    def _on_response(self, page_id: str, response: Response) -> None:
        """Handle network response events."""
        page_state = self._find_page(page_id)
        if not page_state:
            return

        req = page_state._request_map.get(response.url)
        if req:
            req.status = response.status
            req.response_headers = dict(response.headers)
            page_state.network_requests.append(req)
            del page_state._request_map[response.url]


# Global browser manager instance
_browser_manager: Optional[BrowserManager] = None


def get_browser_manager(config: Optional[PlaywrightConfig] = None) -> BrowserManager:
    """Get or create the global browser manager instance."""
    global _browser_manager
    if _browser_manager is None:
        _browser_manager = BrowserManager(config or PlaywrightConfig())
    return _browser_manager
