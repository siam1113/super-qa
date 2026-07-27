"""Test Interpreter - Translates test steps into MCP tool calls."""
import re
import logging
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from enum import Enum

logger = logging.getLogger(__name__)


class ActionType(str, Enum):
    """Types of actions that can be performed."""
    NAVIGATE = "navigate"
    CLICK = "click"
    FILL = "fill"
    SELECT = "select"
    CHECK = "check"
    UNCHECK = "uncheck"
    HOVER = "hover"
    PRESS = "press"
    TYPE = "type"
    WAIT = "wait"
    ASSERT = "assert"
    SCREENSHOT = "screenshot"


@dataclass
class MCPToolCall:
    """Represents a call to an MCP tool."""
    tool_name: str
    arguments: Dict[str, Any]
    description: Optional[str] = None
    expected_result: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "toolName": self.tool_name,
            "arguments": self.arguments,
            "description": self.description,
            "expectedResult": self.expected_result,
        }


@dataclass
class ParsedStep:
    """A parsed test step with MCP tool calls."""
    step_number: int
    description: str
    step_type: str  # setup, action, assertion, cleanup
    tool_calls: List[MCPToolCall] = field(default_factory=list)
    expected_result: Optional[str] = None
    selector: Optional[str] = None
    value: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "stepNumber": self.step_number,
            "description": self.description,
            "stepType": self.step_type,
            "toolCalls": [tc.to_dict() for tc in self.tool_calls],
            "expectedResult": self.expected_result,
            "selector": self.selector,
            "value": self.value,
        }


@dataclass
class TestSpecification:
    """A complete test specification ready for execution."""
    test_id: str
    test_name: str
    steps: List[ParsedStep] = field(default_factory=list)
    preconditions: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)
    priority: str = "P1"
    test_data: Dict[str, Any] = field(default_factory=dict)
    base_url: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "testId": self.test_id,
            "testName": self.test_name,
            "steps": [s.to_dict() for s in self.steps],
            "preconditions": self.preconditions,
            "tags": self.tags,
            "priority": self.priority,
            "testData": self.test_data,
            "baseUrl": self.base_url,
        }


class TestInterpreter:
    """
    Interprets test specifications and translates them into MCP tool calls.

    Supports multiple input formats:
    - Natural language step descriptions
    - Playwright-style selectors and actions
    - Gherkin/BDD scenarios (Given/When/Then)
    - JSON test definitions
    """

    # Patterns for parsing natural language actions
    ACTION_PATTERNS = [
        # Navigation
        (r"(?:go to|navigate to|open|visit)\s+['\"]?([^'\"]+)['\"]?", ActionType.NAVIGATE),
        (r"(?:go back|navigate back)", "go_back"),
        (r"(?:go forward|navigate forward)", "go_forward"),
        (r"(?:reload|refresh)(?:\s+the\s+page)?", "reload"),

        # Clicks
        (r"click\s+(?:on\s+)?(?:the\s+)?['\"]?(.+?)['\"]?(?:\s+button|\s+link|\s+element)?$", ActionType.CLICK),
        (r"double[\s-]?click\s+(?:on\s+)?(?:the\s+)?['\"]?(.+?)['\"]?", "double_click"),

        # Input
        (r"(?:fill|enter|type|input)\s+['\"]?(.+?)['\"]?\s+(?:in|into)\s+(?:the\s+)?['\"]?(.+?)['\"]?", ActionType.FILL),
        (r"(?:fill|enter|type|input)\s+(?:the\s+)?['\"]?(.+?)['\"]?\s+(?:field|input)\s+with\s+['\"]?(.+?)['\"]?", ActionType.FILL),
        (r"clear\s+(?:the\s+)?['\"]?(.+?)['\"]?", "clear"),

        # Select
        (r"select\s+['\"]?(.+?)['\"]?\s+(?:from|in)\s+(?:the\s+)?['\"]?(.+?)['\"]?", ActionType.SELECT),

        # Checkbox
        (r"check\s+(?:the\s+)?['\"]?(.+?)['\"]?", ActionType.CHECK),
        (r"uncheck\s+(?:the\s+)?['\"]?(.+?)['\"]?", ActionType.UNCHECK),

        # Hover
        (r"hover\s+(?:over\s+)?(?:the\s+)?['\"]?(.+?)['\"]?", ActionType.HOVER),

        # Keyboard
        (r"press\s+(?:the\s+)?['\"]?(.+?)['\"]?\s+key(?:\s+on\s+['\"]?(.+?)['\"]?)?", ActionType.PRESS),

        # Wait
        (r"wait\s+(?:for\s+)?(\d+)\s*(?:ms|milliseconds|seconds?|s)?", ActionType.WAIT),
        (r"wait\s+(?:for|until)\s+(?:the\s+)?['\"]?(.+?)['\"]?\s+(?:is\s+)?(?:visible|appears)", "wait_visible"),
        (r"wait\s+(?:for|until)\s+(?:the\s+)?['\"]?(.+?)['\"]?\s+(?:is\s+)?(?:hidden|disappears)", "wait_hidden"),

        # Assertions
        (r"(?:verify|assert|check that|ensure)\s+(?:the\s+)?['\"]?(.+?)['\"]?\s+(?:is\s+)?visible", "assert_visible"),
        (r"(?:verify|assert|check that|ensure)\s+(?:the\s+)?['\"]?(.+?)['\"]?\s+(?:is\s+)?hidden", "assert_hidden"),
        (r"(?:verify|assert|check that|ensure)\s+(?:the\s+)?['\"]?(.+?)['\"]?\s+(?:contains?|has)\s+(?:text\s+)?['\"]?(.+?)['\"]?", "assert_text"),
        (r"(?:verify|assert|check that|ensure)\s+(?:the\s+)?url\s+(?:is|matches|contains)\s+['\"]?(.+?)['\"]?", "assert_url"),
        (r"(?:verify|assert|check that|ensure)\s+(?:the\s+)?(?:page\s+)?title\s+(?:is|matches|contains)\s+['\"]?(.+?)['\"]?", "assert_title"),

        # Screenshot
        (r"(?:take|capture)\s+(?:a\s+)?screenshot", ActionType.SCREENSHOT),
    ]

    # Selector transformations
    SELECTOR_TRANSFORMS = [
        # data-testid patterns
        (r"^[\"\']?([a-zA-Z0-9_-]+)[\"\']?\s+button$", '[data-testid="{0}"]'),
        (r"^[\"\']?([a-zA-Z0-9_-]+)[\"\']?\s+input$", '[data-testid="{0}"]'),
        (r"^[\"\']?([a-zA-Z0-9_-]+)[\"\']?\s+field$", '[data-testid="{0}"]'),

        # Role-based selectors
        (r"^button\s+(?:named|labeled|with text)\s+[\"\']?(.+?)[\"\']?$", 'role=button[name="{0}"]'),
        (r"^link\s+(?:named|labeled|with text)\s+[\"\']?(.+?)[\"\']?$", 'role=link[name="{0}"]'),
        (r"^heading\s+[\"\']?(.+?)[\"\']?$", 'role=heading[name="{0}"]'),

        # Label-based
        (r"^(?:the\s+)?[\"\']?(.+?)[\"\']?\s+(?:text\s*)?(?:input|field)$", 'label="{0}"'),
        (r"^(?:the\s+)?[\"\']?(.+?)[\"\']?\s+checkbox$", 'role=checkbox[name="{0}"]'),
        (r"^(?:the\s+)?[\"\']?(.+?)[\"\']?\s+dropdown$", 'role=combobox[name="{0}"]'),

        # Text content
        (r"^text\s+[\"\']?(.+?)[\"\']?$", 'text="{0}"'),
        (r"^[\"\'](.+)[\"\']$", 'text="{0}"'),
    ]

    def __init__(self):
        self._compiled_patterns = [
            (re.compile(pattern, re.IGNORECASE), action_type)
            for pattern, action_type in self.ACTION_PATTERNS
        ]
        self._selector_patterns = [
            (re.compile(pattern, re.IGNORECASE), template)
            for pattern, template in self.SELECTOR_TRANSFORMS
        ]
        # Context-aware locators from backend
        self._context_locators: Dict[str, Dict[str, Any]] = {}

    def set_locators(self, locators: List[Dict[str, Any]]) -> None:
        """
        Set context-aware locators from backend.

        These locators can include:
        - Element names to selectors mapping
        - Fallback/alternative selectors
        - Reliability scores

        Args:
            locators: List of locator definitions from business items
        """
        for locator in locators:
            name = locator.get("name", "").lower()
            content = locator.get("content", {})
            if name:
                self._context_locators[name] = {
                    "selector": content.get("selector", ""),
                    "type": content.get("type", "css"),
                    "alternatives": content.get("alternatives", []),
                    "reliability": content.get("reliability", 1.0),
                }
        logger.info(f"Loaded {len(self._context_locators)} context locators")

    def _resolve_selector(self, element_name: str) -> str:
        """
        Resolve an element name to a selector using context locators.

        First checks context locators, then falls back to pattern matching.
        """
        # Check context locators first
        name_lower = element_name.lower().strip()
        if name_lower in self._context_locators:
            return self._context_locators[name_lower]["selector"]

        # Try partial matches
        for name, locator in self._context_locators.items():
            if name in name_lower or name_lower in name:
                return locator["selector"]

        # Fall back to pattern-based transformation
        return self._transform_selector(element_name)

    def interpret_test(self, test_data: Dict[str, Any]) -> TestSpecification:
        """
        Interpret a test definition and create a test specification.

        Args:
            test_data: Dictionary containing test definition with:
                - id: Test ID
                - name/title: Test name
                - steps: List of step definitions
                - preconditions: Optional list of preconditions
                - tags: Optional list of tags
                - testData: Optional test data dictionary

        Returns:
            TestSpecification ready for execution
        """
        test_id = test_data.get("id", test_data.get("testId", "unknown"))
        test_name = test_data.get("name", test_data.get("title", "Unnamed Test"))

        spec = TestSpecification(
            test_id=test_id,
            test_name=test_name,
            preconditions=test_data.get("preconditions", []),
            tags=test_data.get("tags", []),
            priority=test_data.get("priority", "P1"),
            test_data=test_data.get("testData", {}),
            base_url=test_data.get("baseUrl"),
        )

        # Parse steps
        steps = test_data.get("steps", [])
        for i, step_def in enumerate(steps, 1):
            parsed_step = self.interpret_step(i, step_def)
            spec.steps.append(parsed_step)

        return spec

    def interpret_step(
        self,
        step_number: int,
        step_def: Dict[str, Any] | str,
    ) -> ParsedStep:
        """
        Interpret a single step definition.

        Args:
            step_number: Step number in the test
            step_def: Step definition (string or dict)

        Returns:
            ParsedStep with MCP tool calls
        """
        # Handle string step definition
        if isinstance(step_def, str):
            step_def = {"action": step_def}

        description = step_def.get("action", step_def.get("description", ""))
        expected = step_def.get("expected", step_def.get("expectedResult"))
        step_type = self._infer_step_type(description)

        parsed = ParsedStep(
            step_number=step_number,
            description=description,
            step_type=step_type,
            expected_result=expected,
        )

        # Generate MCP tool calls from the step description
        tool_calls = self._generate_tool_calls(description, step_def)
        parsed.tool_calls = tool_calls

        return parsed

    def _infer_step_type(self, description: str) -> str:
        """Infer the step type from description."""
        desc_lower = description.lower()

        if any(word in desc_lower for word in ["verify", "assert", "check that", "ensure", "should"]):
            return "assertion"
        elif any(word in desc_lower for word in ["setup", "prepare", "initialize"]):
            return "setup"
        elif any(word in desc_lower for word in ["cleanup", "teardown", "reset"]):
            return "cleanup"
        else:
            return "action"

    def _generate_tool_calls(
        self,
        description: str,
        step_def: Dict[str, Any],
    ) -> List[MCPToolCall]:
        """Generate MCP tool calls from a step description."""
        tool_calls = []

        # Try to match against known patterns
        for pattern, action_type in self._compiled_patterns:
            match = pattern.search(description)
            if match:
                tool_call = self._create_tool_call(action_type, match, step_def)
                if tool_call:
                    tool_calls.append(tool_call)
                break

        # If no pattern matched, try to create a generic action
        if not tool_calls:
            tool_calls = self._create_generic_tool_calls(description, step_def)

        return tool_calls

    def _create_tool_call(
        self,
        action_type: ActionType | str,
        match: re.Match,
        step_def: Dict[str, Any],
    ) -> Optional[MCPToolCall]:
        """Create an MCP tool call from a matched action."""
        groups = match.groups()

        if action_type == ActionType.NAVIGATE or action_type == "goto":
            url = groups[0] if groups else step_def.get("url", "")
            return MCPToolCall(
                tool_name="goto",
                arguments={"url": url},
                description=f"Navigate to {url}",
            )

        elif action_type == "go_back":
            return MCPToolCall(
                tool_name="go_back",
                arguments={},
                description="Navigate back",
            )

        elif action_type == "go_forward":
            return MCPToolCall(
                tool_name="go_forward",
                arguments={},
                description="Navigate forward",
            )

        elif action_type == "reload":
            return MCPToolCall(
                tool_name="reload",
                arguments={},
                description="Reload page",
            )

        elif action_type == ActionType.CLICK:
            selector = self._transform_selector(groups[0] if groups else "")
            return MCPToolCall(
                tool_name="click",
                arguments={"selector": selector},
                description=f"Click {selector}",
            )

        elif action_type == "double_click":
            selector = self._transform_selector(groups[0] if groups else "")
            return MCPToolCall(
                tool_name="click",
                arguments={"selector": selector, "click_count": 2},
                description=f"Double-click {selector}",
            )

        elif action_type == ActionType.FILL:
            if len(groups) >= 2:
                value = groups[0]
                selector = self._transform_selector(groups[1])
            else:
                value = step_def.get("value", "")
                selector = self._transform_selector(step_def.get("selector", ""))
            return MCPToolCall(
                tool_name="fill",
                arguments={"selector": selector, "value": value},
                description=f"Fill {selector} with '{value}'",
            )

        elif action_type == "clear":
            selector = self._transform_selector(groups[0] if groups else "")
            return MCPToolCall(
                tool_name="clear",
                arguments={"selector": selector},
                description=f"Clear {selector}",
            )

        elif action_type == ActionType.SELECT:
            if len(groups) >= 2:
                value = groups[0]
                selector = self._transform_selector(groups[1])
            else:
                value = step_def.get("value", "")
                selector = self._transform_selector(step_def.get("selector", ""))
            return MCPToolCall(
                tool_name="select_option",
                arguments={"selector": selector, "label": value},
                description=f"Select '{value}' from {selector}",
            )

        elif action_type == ActionType.CHECK:
            selector = self._transform_selector(groups[0] if groups else "")
            return MCPToolCall(
                tool_name="check",
                arguments={"selector": selector},
                description=f"Check {selector}",
            )

        elif action_type == ActionType.UNCHECK:
            selector = self._transform_selector(groups[0] if groups else "")
            return MCPToolCall(
                tool_name="uncheck",
                arguments={"selector": selector},
                description=f"Uncheck {selector}",
            )

        elif action_type == ActionType.HOVER:
            selector = self._transform_selector(groups[0] if groups else "")
            return MCPToolCall(
                tool_name="hover",
                arguments={"selector": selector},
                description=f"Hover over {selector}",
            )

        elif action_type == ActionType.PRESS:
            key = groups[0] if groups else ""
            selector = groups[1] if len(groups) > 1 and groups[1] else None
            args = {"key": key}
            if selector:
                args["selector"] = self._transform_selector(selector)
            return MCPToolCall(
                tool_name="press",
                arguments=args,
                description=f"Press {key}",
            )

        elif action_type == ActionType.WAIT:
            timeout_str = groups[0] if groups else "1000"
            timeout = int(timeout_str)
            # Convert seconds to milliseconds if needed
            if timeout < 100:
                timeout *= 1000
            return MCPToolCall(
                tool_name="wait_for_timeout",
                arguments={"timeout": timeout},
                description=f"Wait {timeout}ms",
            )

        elif action_type == "wait_visible":
            selector = self._transform_selector(groups[0] if groups else "")
            return MCPToolCall(
                tool_name="wait_for_selector",
                arguments={"selector": selector, "state": "visible"},
                description=f"Wait for {selector} to be visible",
            )

        elif action_type == "wait_hidden":
            selector = self._transform_selector(groups[0] if groups else "")
            return MCPToolCall(
                tool_name="wait_for_selector",
                arguments={"selector": selector, "state": "hidden"},
                description=f"Wait for {selector} to be hidden",
            )

        elif action_type == "assert_visible":
            selector = self._transform_selector(groups[0] if groups else "")
            return MCPToolCall(
                tool_name="expect_visible",
                arguments={"selector": selector},
                description=f"Assert {selector} is visible",
                expected_result="Element is visible",
            )

        elif action_type == "assert_hidden":
            selector = self._transform_selector(groups[0] if groups else "")
            return MCPToolCall(
                tool_name="expect_hidden",
                arguments={"selector": selector},
                description=f"Assert {selector} is hidden",
                expected_result="Element is hidden",
            )

        elif action_type == "assert_text":
            selector = self._transform_selector(groups[0] if groups else "")
            expected_text = groups[1] if len(groups) > 1 else ""
            return MCPToolCall(
                tool_name="expect_text",
                arguments={"selector": selector, "expected_text": expected_text},
                description=f"Assert {selector} contains '{expected_text}'",
                expected_result=f"Text contains '{expected_text}'",
            )

        elif action_type == "assert_url":
            url_pattern = groups[0] if groups else ""
            return MCPToolCall(
                tool_name="expect_url",
                arguments={"url_pattern": url_pattern},
                description=f"Assert URL matches '{url_pattern}'",
                expected_result=f"URL matches '{url_pattern}'",
            )

        elif action_type == "assert_title":
            title_pattern = groups[0] if groups else ""
            return MCPToolCall(
                tool_name="expect_title",
                arguments={"title_pattern": title_pattern},
                description=f"Assert title matches '{title_pattern}'",
                expected_result=f"Title matches '{title_pattern}'",
            )

        elif action_type == ActionType.SCREENSHOT:
            return MCPToolCall(
                tool_name="screenshot",
                arguments={},
                description="Capture screenshot",
            )

        return None

    def _create_generic_tool_calls(
        self,
        description: str,
        step_def: Dict[str, Any],
    ) -> List[MCPToolCall]:
        """Create generic tool calls when no pattern matches."""
        # Check if step_def has explicit action/selector/value
        if "tool" in step_def or "toolName" in step_def:
            tool_name = step_def.get("tool", step_def.get("toolName"))
            arguments = step_def.get("arguments", {})
            return [MCPToolCall(
                tool_name=tool_name,
                arguments=arguments,
                description=description,
            )]

        # If it looks like an assertion, default to expect_visible
        if "verify" in description.lower() or "assert" in description.lower():
            selector = step_def.get("selector", description)
            return [MCPToolCall(
                tool_name="expect_visible",
                arguments={"selector": self._transform_selector(selector)},
                description=description,
            )]

        logger.warning(f"Could not parse step: {description}")
        return []

    def _transform_selector(self, selector: str) -> str:
        """Transform a natural language selector into Playwright format."""
        selector = selector.strip()

        # If it already looks like a valid selector, return as-is
        if any(selector.startswith(prefix) for prefix in [
            "#", ".", "[", "//", "role=", "text=", "label=", "data-testid=",
            "css=", "xpath=", "id=", "placeholder=", "alt=", "title=",
        ]):
            return selector

        # Try to match against transform patterns
        for pattern, template in self._selector_patterns:
            match = pattern.match(selector)
            if match:
                return template.format(*match.groups())

        # Default: treat as text selector
        return f'text="{selector}"'

    def parse_playwright_action(self, action_code: str) -> Optional[MCPToolCall]:
        """
        Parse a Playwright-style action code.

        Examples:
            - await page.click('button#submit')
            - await page.fill('[name="email"]', 'test@example.com')
            - await page.goto('https://example.com')
        """
        # Match common Playwright patterns
        patterns = [
            (r"page\.goto\(['\"]([^'\"]+)['\"]", "goto", ["url"]),
            (r"page\.click\(['\"]([^'\"]+)['\"]", "click", ["selector"]),
            (r"page\.fill\(['\"]([^'\"]+)['\"],\s*['\"]([^'\"]+)['\"]", "fill", ["selector", "value"]),
            (r"page\.check\(['\"]([^'\"]+)['\"]", "check", ["selector"]),
            (r"page\.uncheck\(['\"]([^'\"]+)['\"]", "uncheck", ["selector"]),
            (r"page\.hover\(['\"]([^'\"]+)['\"]", "hover", ["selector"]),
            (r"page\.press\(['\"]([^'\"]+)['\"],\s*['\"]([^'\"]+)['\"]", "press", ["selector", "key"]),
            (r"page\.selectOption\(['\"]([^'\"]+)['\"],\s*['\"]([^'\"]+)['\"]", "select_option", ["selector", "value"]),
        ]

        for pattern, tool_name, arg_names in patterns:
            match = re.search(pattern, action_code)
            if match:
                arguments = dict(zip(arg_names, match.groups()))
                return MCPToolCall(
                    tool_name=tool_name,
                    arguments=arguments,
                    description=action_code,
                )

        return None
