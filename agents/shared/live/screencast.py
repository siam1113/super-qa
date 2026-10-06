"""CDP screencast capture for live-streaming a Playwright page as it runs."""
import asyncio
import logging
from typing import Callable, Optional

from playwright.async_api import Page

logger = logging.getLogger(__name__)


class ScreencastStreamer:
    """Streams a page's rendered frames via Chrome DevTools Protocol.

    Only works against Chromium (CDP). Frames are delivered as data URLs to
    `on_frame`, which must be a cheap, synchronous callback (it runs inline
    with the CDP event dispatch) — typically just a registry publish.
    """

    def __init__(self, page: Page, on_frame: Callable[[str], None]):
        self._page = page
        self._on_frame = on_frame
        self._cdp = None
        self._stopped = False

    async def start(self) -> None:
        self._cdp = await self._page.context.new_cdp_session(self._page)
        self._cdp.on("Page.screencastFrame", self._handle_frame)
        await self._cdp.send("Page.startScreencast", {
            "format": "jpeg",
            "quality": 60,
            "maxWidth": 1280,
            "maxHeight": 800,
            "everyNthFrame": 1,
        })

    def _handle_frame(self, params: dict) -> None:
        if self._stopped:
            return
        data = params.get("data")
        if data:
            try:
                self._on_frame(f"data:image/jpeg;base64,{data}")
            except Exception as error:
                logger.warning(f"Live frame callback failed: {error}")
        session_id = params.get("sessionId")
        if session_id is not None:
            asyncio.create_task(self._ack(session_id))

    async def _ack(self, session_id: int) -> None:
        try:
            await self._cdp.send("Page.screencastFrameAck", {"sessionId": session_id})
        except Exception:
            pass

    async def stop(self) -> None:
        self._stopped = True
        if self._cdp is None:
            return
        try:
            await self._cdp.send("Page.stopScreencast")
        except Exception:
            pass
        try:
            await self._cdp.detach()
        except Exception:
            pass
