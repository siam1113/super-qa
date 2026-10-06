"""Test Interpreter - Parses manual test-case steps into executable metadata.

Steps are deliberately NOT translated into concrete Playwright calls here anymore:
manual test cases are meant to be vague, high-level descriptions (e.g. "select
Estimator or Snap & Estimate"), and only the live page — inspected while the browser
is actually open — can ground that into real selectors and actions. That grounding
now happens in TestExecutor's per-step agentic loop (see grounded_step.py); this
module just extracts the step's description/expected-result/type and the test's
metadata (base URL, preconditions, locator hints) ahead of execution.
"""
import logging
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Union

logger = logging.getLogger(__name__)


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
    Parses a manual test case's steps into metadata (description, expected result,
    step type) and the test's own metadata (base URL, preconditions, locator hints).

    Deliberately does NOT translate step text into concrete Playwright calls — that
    requires looking at the live page, which only happens once the browser is open,
    inside TestExecutor's per-step grounded loop (grounded_step.py).
    """

    def __init__(self):
        # Context-aware locators from backend, surfaced as hints to the grounded
        # step loop's prompt (not resolved/substituted here).
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
        step_def: Union[Dict[str, Any], str],
    ) -> ParsedStep:
        """
        Interpret a single step definition.

        Args:
            step_number: Step number in the test
            step_def: Step definition (string or dict)

        Returns:
            ParsedStep with description/expected-result metadata. tool_calls stays
            empty — TestExecutor's grounded loop decides those live, against the
            actual page, once the browser is open.
        """
        # Handle string step definition
        if isinstance(step_def, str):
            step_def = {"action": step_def}

        description = step_def.get("action", step_def.get("description", ""))
        expected = step_def.get("expected", step_def.get("expectedResult"))
        step_type = self._infer_step_type(description)

        return ParsedStep(
            step_number=step_number,
            description=description,
            step_type=step_type,
            expected_result=expected,
        )

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
