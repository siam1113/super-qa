"""Playwright MCP Tools - Browser automation tools exposed via MCP."""
from .browser import (
    browser_launch,
    browser_close,
    context_create,
    context_close,
    page_create,
    page_close,
)
from .navigation import (
    goto,
    go_back,
    go_forward,
    reload,
    get_current_url,
    get_title,
)
from .interaction import (
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
)
from .capture import (
    accessibility_snapshot,
    screenshot,
    get_console_logs,
    get_network_requests,
    get_page_content,
    evaluate,
)
from .assertions import (
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
    expect_download,
)
from .waiting import (
    wait_for_selector,
    wait_for_navigation,
    wait_for_load_state,
    wait_for_timeout,
    wait_for_url,
)

__all__ = [
    # Browser lifecycle
    "browser_launch",
    "browser_close",
    "context_create",
    "context_close",
    "page_create",
    "page_close",
    # Navigation
    "goto",
    "go_back",
    "go_forward",
    "reload",
    "get_current_url",
    "get_title",
    # Interaction
    "click",
    "fill",
    "clear",
    "select_option",
    "check",
    "uncheck",
    "hover",
    "focus",
    "press",
    "type_text",
    # Capture
    "accessibility_snapshot",
    "screenshot",
    "get_console_logs",
    "get_network_requests",
    "get_page_content",
    "evaluate",
    # Assertions
    "expect_visible",
    "expect_hidden",
    "expect_text",
    "expect_value",
    "expect_url",
    "expect_title",
    "expect_element_count",
    "expect_checked",
    "expect_enabled",
    "expect_attribute",
    "expect_download",
    # Waiting
    "wait_for_selector",
    "wait_for_navigation",
    "wait_for_load_state",
    "wait_for_timeout",
    "wait_for_url",
]
