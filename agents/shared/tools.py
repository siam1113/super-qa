"""Shared tools for agents to interact with the backend."""
import os
import httpx
from langchain_core.tools import tool
from typing import Literal


BACKEND_URL = os.getenv("BACKEND_API_URL", "http://localhost:4000/api")


async def _search_business_items(query: str, item_type: str | None = None) -> list[dict]:
    """Search business items from the backend."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        # NestJS uses 'q' for query and 'types' for comma-separated types
        params = {"q": query}
        if item_type:
            params["types"] = item_type
        try:
            response = await client.get(f"{BACKEND_URL}/business/search", params=params)
            if response.status_code == 200:
                # Response is an array directly, not wrapped in 'items'
                data = response.json()
                return data if isinstance(data, list) else data.get("items", [])
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Business search failed: {e}")
    return []


# QAE Tools
@tool
async def search_test_cases(query: str) -> str:
    """Search for existing test cases related to a query.

    Args:
        query: Search query for finding test cases

    Returns:
        Formatted list of matching test cases
    """
    items = await _search_business_items(query, "test_case")
    if not items:
        return "No test cases found matching the query."

    result = f"Found {len(items)} test case(s):\n\n"
    for item in items[:5]:
        result += f"- **{item.get('name', 'Unnamed')}**: {item.get('description', 'No description')}\n"
    return result


@tool
async def search_requirements(query: str) -> str:
    """Search for requirements and business rules.

    Args:
        query: Search query for finding requirements

    Returns:
        Formatted list of matching requirements
    """
    items = await _search_business_items(query, "requirement")
    rules = await _search_business_items(query, "rule")
    all_items = items + rules

    if not all_items:
        return "No requirements or rules found matching the query."

    result = f"Found {len(all_items)} requirement(s)/rule(s):\n\n"
    for item in all_items[:5]:
        result += f"- **{item.get('name', 'Unnamed')}** ({item.get('type', 'unknown')}): {item.get('description', 'No description')}\n"
    return result


@tool
async def analyze_risk(feature_name: str) -> str:
    """Analyze risk level for a feature or flow.

    Args:
        feature_name: Name of the feature or flow to analyze

    Returns:
        Risk analysis summary
    """
    flows = await _search_business_items(feature_name, "flow")
    tests = await _search_business_items(feature_name, "test_case")
    defects = await _search_business_items(feature_name, "defect")

    risk_level = "high" if len(flows) == 0 else "medium" if len(tests) < 3 else "low"

    return f"""**Risk Analysis for '{feature_name}':**

- **Risk Level**: {risk_level.upper()}
- **Flows Found**: {len(flows)}
- **Test Coverage**: {len(tests)} test case(s)
- **Known Defects**: {len(defects)}

{"⚠️ Consider adding more test coverage." if risk_level != "low" else "✅ Good test coverage."}"""


@tool
def generate_test_cases(requirement: str) -> str:
    """Generate test case suggestions for a requirement.

    Args:
        requirement: The requirement or feature to generate test cases for

    Returns:
        Suggested test cases
    """
    return f"""**Suggested Test Cases for: {requirement}**

1. **[P0] Happy Path**: Verify {requirement} works correctly with valid inputs
2. **[P0] Error Handling**: Verify appropriate error messages for invalid inputs
3. **[P1] Edge Cases**: Test boundary conditions and limit values
4. **[P1] Integration**: Verify interactions with dependent systems
5. **[P2] Performance**: Check response times under normal load
6. **[P2] Security**: Verify authorization and input validation

Would you like me to elaborate on any of these test cases?"""


# AUE Tools
@tool
async def search_locators(element_description: str) -> str:
    """Search for existing locators for UI elements.

    Args:
        element_description: Description of the UI element

    Returns:
        Matching locators and strategies
    """
    items = await _search_business_items(element_description, "locator")
    dom_items = await _search_business_items(element_description, "dom")
    all_items = items + dom_items

    if not all_items:
        return f"No existing locators found. Recommended strategy for '{element_description}':\n\n1. Use `data-testid` attribute (most stable)\n2. Fall back to `getByRole()` with accessible name\n3. Use text content as last resort"

    result = f"Found {len(all_items)} locator(s):\n\n"
    for item in all_items[:5]:
        result += f"- **{item.get('name', 'Unnamed')}**: `{item.get('content', {}).get('selector', 'N/A')}`\n"
    return result


@tool
async def search_page_objects(page_name: str) -> str:
    """Search for existing page objects.

    Args:
        page_name: Name of the page to find

    Returns:
        Matching page objects and their elements
    """
    items = await _search_business_items(page_name, "dom")
    code_items = await _search_business_items(page_name, "code")
    all_items = items + code_items

    if not all_items:
        return f"No existing page objects found for '{page_name}'. Consider creating a new page object class."

    result = f"Found {len(all_items)} page object(s):\n\n"
    for item in all_items[:5]:
        result += f"- **{item.get('name', 'Unnamed')}**: {item.get('description', 'No description')}\n"
    return result


@tool
def generate_script(
    test_description: str,
    framework: Literal["playwright", "cypress"] = "playwright"
) -> str:
    """Generate a test automation script.

    Args:
        test_description: Description of the test to generate
        framework: Test framework to use (playwright or cypress)

    Returns:
        Generated test script
    """
    if framework == "playwright":
        return f'''```typescript
import {{ test, expect }} from '@playwright/test';

test('{test_description}', async ({{ page }}) => {{
  // Navigate to the page
  await page.goto('/');

  // TODO: Add test steps based on requirements
  // Example:
  // await page.getByTestId('login-button').click();
  // await page.getByLabel('Email').fill('user@example.com');

  // Add assertions
  await expect(page).toHaveTitle(/Expected Title/);
}});
```

**Tips:**
- Use `data-testid` for stable locators
- Add explicit waits with `waitFor`
- Use soft assertions for non-critical checks'''

    else:  # cypress
        return f'''```typescript
describe('{test_description}', () => {{
  beforeEach(() => {{
    cy.visit('/');
  }});

  it('should complete successfully', () => {{
    // TODO: Add test steps based on requirements
    // Example:
    // cy.get('[data-testid="login-button"]').click();
    // cy.get('[aria-label="Email"]').type('user@example.com');

    // Add assertions
    cy.title().should('contain', 'Expected Title');
  }});
}});
```

**Tips:**
- Use `data-testid` for stable selectors
- Chain assertions with `.should()`
- Use `cy.intercept()` for API mocking'''


@tool
def analyze_failure(error_message: str) -> str:
    """Analyze a test failure and suggest fixes.

    Args:
        error_message: The error message from the failed test

    Returns:
        Analysis and suggested fixes
    """
    error_lower = error_message.lower()

    suggestions = []

    if "timeout" in error_lower:
        suggestions.append("- **Timeout Issue**: Increase timeout or add explicit waits\n  ```typescript\n  await page.waitForSelector('[data-testid=\"element\"]', { timeout: 10000 });\n  ```")

    if "element not found" in error_lower or "no element" in error_lower:
        suggestions.append("- **Element Not Found**: Check if selector is correct or element exists\n  ```typescript\n  // Use more specific selector\n  await page.getByTestId('unique-id');\n  // Or wait for element\n  await page.waitForSelector('[data-testid=\"element\"]');\n  ```")

    if "stale" in error_lower:
        suggestions.append("- **Stale Element**: Re-query element after page changes\n  ```typescript\n  // Re-fetch element after interaction\n  await page.click('[data-testid=\"trigger\"]');\n  const element = page.getByTestId('target'); // Fresh reference\n  ```")

    if "assertion" in error_lower or "expect" in error_lower:
        suggestions.append("- **Assertion Failed**: Verify expected values match application state\n  - Check if test data is correct\n  - Verify API responses are as expected")

    if not suggestions:
        suggestions.append("- Review the test for race conditions\n- Ensure test data is properly set up\n- Check for recent application changes")

    return f"""**Failure Analysis:**

Error: `{error_message[:200]}...`

**Possible Causes & Fixes:**

{chr(10).join(suggestions)}

**General Debugging Tips:**
1. Run test in headed mode to observe behavior
2. Add screenshots at failure points
3. Check network requests for errors
4. Verify test isolation (no shared state)"""


def create_tools(agent_type: Literal["qae", "aue"]) -> list:
    """Create tools list based on agent type."""
    if agent_type == "qae":
        return [
            search_test_cases,
            search_requirements,
            analyze_risk,
            generate_test_cases,
        ]
    else:  # aue
        return [
            search_locators,
            search_page_objects,
            generate_script,
            analyze_failure,
        ]
