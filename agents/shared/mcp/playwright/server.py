"""Playwright MCP Server - Entry point for the MCP server."""
import os
import asyncio
import logging
from typing import Any, Dict, List, Optional
from contextlib import asynccontextmanager

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

from .context import BrowserManager, get_browser_manager
from .types import PlaywrightConfig, TraceLevel
from .tools import (
    # Browser lifecycle
    browser_launch,
    browser_close,
    context_create,
    context_close,
    page_create,
    page_close,
    # Navigation
    goto,
    go_back,
    go_forward,
    reload,
    get_current_url,
    get_title,
    # Interaction
    click,
    fill,
    clear,
    select_option,
    check,
    uncheck,
    hover,
    focus,
    press,
    type_text,
    # Capture
    screenshot,
    get_console_logs,
    get_network_requests,
    get_page_content,
    evaluate,
    # Assertions
    expect_visible,
    expect_hidden,
    expect_text,
    expect_value,
    expect_url,
    expect_title,
    expect_element_count,
    expect_checked,
    expect_enabled,
    expect_attribute,
    # Waiting
    wait_for_selector,
    wait_for_navigation,
    wait_for_load_state,
    wait_for_timeout,
    wait_for_url,
)

logger = logging.getLogger(__name__)

# Tool registry mapping tool names to functions
TOOL_REGISTRY: Dict[str, Any] = {
    # Browser lifecycle
    "browser_launch": browser_launch,
    "browser_close": browser_close,
    "context_create": context_create,
    "context_close": context_close,
    "page_create": page_create,
    "page_close": page_close,
    # Navigation
    "goto": goto,
    "go_back": go_back,
    "go_forward": go_forward,
    "reload": reload,
    "get_current_url": get_current_url,
    "get_title": get_title,
    # Interaction
    "click": click,
    "fill": fill,
    "clear": clear,
    "select_option": select_option,
    "check": check,
    "uncheck": uncheck,
    "hover": hover,
    "focus": focus,
    "press": press,
    "type_text": type_text,
    # Capture
    "screenshot": screenshot,
    "get_console_logs": get_console_logs,
    "get_network_requests": get_network_requests,
    "get_page_content": get_page_content,
    "evaluate": evaluate,
    # Assertions
    "expect_visible": expect_visible,
    "expect_hidden": expect_hidden,
    "expect_text": expect_text,
    "expect_value": expect_value,
    "expect_url": expect_url,
    "expect_title": expect_title,
    "expect_element_count": expect_element_count,
    "expect_checked": expect_checked,
    "expect_enabled": expect_enabled,
    "expect_attribute": expect_attribute,
    # Waiting
    "wait_for_selector": wait_for_selector,
    "wait_for_navigation": wait_for_navigation,
    "wait_for_load_state": wait_for_load_state,
    "wait_for_timeout": wait_for_timeout,
    "wait_for_url": wait_for_url,
}

# Tool definitions for MCP
TOOL_DEFINITIONS: List[Tool] = [
    # Browser lifecycle tools
    Tool(
        name="browser_launch",
        description="Launch a new browser instance (Chromium, Firefox, or WebKit)",
        inputSchema={
            "type": "object",
            "properties": {
                "browser_type": {
                    "type": "string",
                    "enum": ["chromium", "firefox", "webkit"],
                    "description": "Type of browser to launch",
                    "default": "chromium",
                },
                "headless": {
                    "type": "boolean",
                    "description": "Run browser in headless mode",
                    "default": True,
                },
                "slow_mo": {
                    "type": "integer",
                    "description": "Slow down operations by specified milliseconds",
                    "default": 0,
                },
                "viewport_width": {
                    "type": "integer",
                    "description": "Default viewport width",
                    "default": 1280,
                },
                "viewport_height": {
                    "type": "integer",
                    "description": "Default viewport height",
                    "default": 720,
                },
            },
        },
    ),
    Tool(
        name="browser_close",
        description="Close a browser session and cleanup resources",
        inputSchema={
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "Browser session ID to close",
                },
            },
            "required": ["session_id"],
        },
    ),
    Tool(
        name="context_create",
        description="Create a new browser context (isolated cookies/localStorage)",
        inputSchema={
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "Browser session ID",
                },
                "storage_state": {
                    "type": "string",
                    "description": "Path to saved storage state for authentication",
                },
                "locale": {
                    "type": "string",
                    "description": "Browser locale (e.g., en-US)",
                    "default": "en-US",
                },
                "timezone": {
                    "type": "string",
                    "description": "Browser timezone",
                    "default": "America/New_York",
                },
                "record_video": {
                    "type": "boolean",
                    "description": "Whether to record video (defaults to config setting)",
                },
                "video_dir": {
                    "type": "string",
                    "description": "Directory to save videos (defaults to config setting)",
                },
            },
            "required": ["session_id"],
        },
    ),
    Tool(
        name="page_create",
        description="Create a new page/tab in a browser context",
        inputSchema={
            "type": "object",
            "properties": {
                "context_id": {
                    "type": "string",
                    "description": "Browser context ID",
                },
            },
            "required": ["context_id"],
        },
    ),
    # Navigation tools
    Tool(
        name="goto",
        description="Navigate to a URL with before/after screenshots",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string", "description": "Page ID"},
                "url": {"type": "string", "description": "URL to navigate to"},
                "wait_until": {
                    "type": "string",
                    "enum": ["load", "domcontentloaded", "networkidle", "commit"],
                    "default": "load",
                },
                "timeout": {"type": "integer", "default": 30000},
                "capture_before": {"type": "boolean", "default": True},
                "capture_after": {"type": "boolean", "default": True},
            },
            "required": ["page_id", "url"],
        },
    ),
    # Interaction tools
    Tool(
        name="click",
        description="Click an element with before/after screenshots",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string", "description": "Page ID"},
                "selector": {"type": "string", "description": "Element selector"},
                "button": {
                    "type": "string",
                    "enum": ["left", "right", "middle"],
                    "default": "left",
                },
                "click_count": {"type": "integer", "default": 1},
                "timeout": {"type": "integer", "default": 30000},
                "force": {"type": "boolean", "default": False},
                "capture_before": {"type": "boolean", "default": True},
                "capture_after": {"type": "boolean", "default": True},
            },
            "required": ["page_id", "selector"],
        },
    ),
    Tool(
        name="fill",
        description="Fill a text input with value (clears existing content)",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string", "description": "Page ID"},
                "selector": {"type": "string", "description": "Input selector"},
                "value": {"type": "string", "description": "Value to fill"},
                "timeout": {"type": "integer", "default": 30000},
                "capture_before": {"type": "boolean", "default": True},
                "capture_after": {"type": "boolean", "default": True},
            },
            "required": ["page_id", "selector", "value"],
        },
    ),
    Tool(
        name="select_option",
        description="Select option from dropdown",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "selector": {"type": "string"},
                "value": {"type": "string", "description": "Option value"},
                "label": {"type": "string", "description": "Option label text"},
                "index": {"type": "integer", "description": "Option index (0-based)"},
                "timeout": {"type": "integer", "default": 30000},
            },
            "required": ["page_id", "selector"],
        },
    ),
    Tool(
        name="check",
        description="Check a checkbox",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "selector": {"type": "string"},
                "timeout": {"type": "integer", "default": 30000},
            },
            "required": ["page_id", "selector"],
        },
    ),
    Tool(
        name="hover",
        description="Hover over an element",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "selector": {"type": "string"},
                "timeout": {"type": "integer", "default": 30000},
            },
            "required": ["page_id", "selector"],
        },
    ),
    Tool(
        name="press",
        description="Press keyboard key on element",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "selector": {"type": "string"},
                "key": {"type": "string", "description": "Key to press (e.g., Enter, Tab)"},
                "timeout": {"type": "integer", "default": 30000},
            },
            "required": ["page_id", "selector", "key"],
        },
    ),
    Tool(
        name="type_text",
        description="Type text character by character (simulates real typing)",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "selector": {"type": "string"},
                "text": {"type": "string"},
                "delay": {"type": "integer", "default": 50, "description": "Delay between keystrokes (ms)"},
                "timeout": {"type": "integer", "default": 30000},
            },
            "required": ["page_id", "selector", "text"],
        },
    ),
    # Capture tools
    Tool(
        name="screenshot",
        description="Capture screenshot of page or element",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "full_page": {"type": "boolean", "default": False},
                "selector": {"type": "string", "description": "Element to screenshot"},
                "format": {"type": "string", "enum": ["png", "jpeg"], "default": "png"},
            },
            "required": ["page_id"],
        },
    ),
    Tool(
        name="get_console_logs",
        description="Get console logs captured from the page",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "level_filter": {"type": "string", "enum": ["log", "warn", "error", "info", "debug"]},
                "clear": {"type": "boolean", "default": False},
                "limit": {"type": "integer", "default": 100},
            },
            "required": ["page_id"],
        },
    ),
    Tool(
        name="get_network_requests",
        description="Get network requests captured from the page",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "url_filter": {"type": "string"},
                "method_filter": {"type": "string", "enum": ["GET", "POST", "PUT", "DELETE", "PATCH"]},
                "clear": {"type": "boolean", "default": False},
                "limit": {"type": "integer", "default": 100},
            },
            "required": ["page_id"],
        },
    ),
    Tool(
        name="evaluate",
        description="Evaluate JavaScript in page context",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "expression": {"type": "string", "description": "JavaScript expression"},
            },
            "required": ["page_id", "expression"],
        },
    ),
    # Assertion tools
    Tool(
        name="expect_visible",
        description="Assert element is visible",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "selector": {"type": "string"},
                "timeout": {"type": "integer", "default": 5000},
                "capture_screenshot": {"type": "boolean", "default": True},
            },
            "required": ["page_id", "selector"],
        },
    ),
    Tool(
        name="expect_text",
        description="Assert element contains expected text",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "selector": {"type": "string"},
                "expected_text": {"type": "string"},
                "exact": {"type": "boolean", "default": False},
                "timeout": {"type": "integer", "default": 5000},
            },
            "required": ["page_id", "selector", "expected_text"],
        },
    ),
    Tool(
        name="expect_value",
        description="Assert input has expected value",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "selector": {"type": "string"},
                "expected_value": {"type": "string"},
                "timeout": {"type": "integer", "default": 5000},
            },
            "required": ["page_id", "selector", "expected_value"],
        },
    ),
    Tool(
        name="expect_url",
        description="Assert page URL matches pattern",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "url_pattern": {"type": "string"},
                "timeout": {"type": "integer", "default": 5000},
            },
            "required": ["page_id", "url_pattern"],
        },
    ),
    Tool(
        name="expect_title",
        description="Assert page title matches pattern",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "title_pattern": {"type": "string"},
                "timeout": {"type": "integer", "default": 5000},
            },
            "required": ["page_id", "title_pattern"],
        },
    ),
    # Waiting tools
    Tool(
        name="wait_for_selector",
        description="Wait for element to reach state (visible, hidden, attached, detached)",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "selector": {"type": "string"},
                "state": {
                    "type": "string",
                    "enum": ["attached", "detached", "visible", "hidden"],
                    "default": "visible",
                },
                "timeout": {"type": "integer", "default": 30000},
            },
            "required": ["page_id", "selector"],
        },
    ),
    Tool(
        name="wait_for_navigation",
        description="Wait for navigation to complete",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "url_pattern": {"type": "string"},
                "wait_until": {
                    "type": "string",
                    "enum": ["load", "domcontentloaded", "networkidle", "commit"],
                    "default": "load",
                },
                "timeout": {"type": "integer", "default": 30000},
            },
            "required": ["page_id"],
        },
    ),
    Tool(
        name="wait_for_load_state",
        description="Wait for page load state",
        inputSchema={
            "type": "object",
            "properties": {
                "page_id": {"type": "string"},
                "state": {
                    "type": "string",
                    "enum": ["load", "domcontentloaded", "networkidle"],
                    "default": "load",
                },
                "timeout": {"type": "integer", "default": 30000},
            },
            "required": ["page_id"],
        },
    ),
]


def create_server(config: Optional[PlaywrightConfig] = None) -> Server:
    """Create and configure the MCP server."""
    server = Server("playwright-mcp")

    # Initialize browser manager with config
    browser_manager = get_browser_manager(config or PlaywrightConfig())

    @server.list_tools()
    async def list_tools() -> List[Tool]:
        """List all available tools."""
        return TOOL_DEFINITIONS

    @server.call_tool()
    async def call_tool(name: str, arguments: Dict[str, Any]) -> List[TextContent]:
        """Execute a tool and return results."""
        if name not in TOOL_REGISTRY:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]

        try:
            tool_func = TOOL_REGISTRY[name]
            result = await tool_func(**arguments)

            # Convert result to string if needed
            if isinstance(result, dict):
                import json
                result_text = json.dumps(result, indent=2, default=str)
            else:
                result_text = str(result)

            return [TextContent(type="text", text=result_text)]

        except Exception as e:
            logger.error(f"Tool {name} failed: {e}")
            return [TextContent(type="text", text=f"Error: {str(e)}")]

    return server


async def run_server():
    """Run the MCP server."""
    # Load config from environment
    config = PlaywrightConfig(
        headless=os.getenv("PLAYWRIGHT_HEADLESS", "true").lower() == "true",
        slow_mo=int(os.getenv("PLAYWRIGHT_SLOW_MO", "0")),
        default_timeout=int(os.getenv("PLAYWRIGHT_DEFAULT_TIMEOUT", "30000")),
        viewport_width=int(os.getenv("PLAYWRIGHT_VIEWPORT_WIDTH", "1280")),
        viewport_height=int(os.getenv("PLAYWRIGHT_VIEWPORT_HEIGHT", "720")),
        capture_screenshots=os.getenv("TRACE_SCREENSHOTS", "true").lower() == "true",
        capture_console_logs=os.getenv("TRACE_CONSOLE_LOGS", "true").lower() == "true",
        capture_network=os.getenv("TRACE_NETWORK", "true").lower() == "true",
        trace_level=TraceLevel(os.getenv("TRACE_LEVEL", "action")),
        storage_backend_url=os.getenv("BACKEND_API_URL", "http://localhost:4000/api"),
    )

    server = create_server(config)

    # Initialize browser manager
    browser_manager = get_browser_manager()
    await browser_manager.initialize()

    try:
        async with stdio_server() as (read_stream, write_stream):
            await server.run(
                read_stream,
                write_stream,
                server.create_initialization_options(),
            )
    finally:
        # Cleanup
        await browser_manager.shutdown()


def main():
    """Entry point for running the server."""
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_server())


if __name__ == "__main__":
    main()
