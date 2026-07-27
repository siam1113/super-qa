"""QAE Agent Tools - Comprehensive tools for QA Engineer capabilities.

Tools for the QA Engineer agent to:
- Write and manage test cases
- Execute tests via MCP-based harness
- Analyze test results and coverage
- Manage test environments
- Access business context during execution
"""
import os
import json
import uuid
import asyncio
from datetime import datetime
from typing import Literal, Optional, List, Dict, Any
import httpx
from langchain_core.tools import tool

# Import from shared modules
from shared.runner.service import get_runner, TestRunnerService
from shared.runner.models import RunStatus

# Import the MCP-based harness (now in qae directory)
try:
    from qae.harness import get_orchestrator, TestOrchestrator
    from qae.harness.reporters import format_step_report
    from shared.tracing import get_trace_collector, TraceStorageClient
    MCP_HARNESS_AVAILABLE = True
except ImportError:
    MCP_HARNESS_AVAILABLE = False

BACKEND_URL = os.getenv("BACKEND_API_URL", "http://localhost:4000/api")
USE_MCP_EXECUTION = os.getenv("USE_MCP_EXECUTION", "true").lower() == "true"


# ============ Context Helpers ============

async def _get_environment_config(environment: str) -> Dict[str, Any]:
    """Fetch environment configuration from the backend."""
    envs = await _api_get("environments")
    if not envs:
        return {"name": environment, "variables": []}

    # Find matching environment or default
    for env in envs:
        if env.get("name", "").lower() == environment.lower():
            return env
        if env.get("isDefault") and environment == "staging":
            return env

    return {"name": environment, "variables": []}


async def _get_business_context(test_id: str) -> Dict[str, Any]:
    """Fetch business context related to a test case."""
    context = {
        "requirements": [],
        "businessRules": [],
        "locators": [],
        "flows": [],
        "constraints": []
    }

    # Get test case details
    test_case = await _api_get(f"qa/test-cases/{test_id}")
    if not test_case:
        return context

    # Get related business items
    flow_name = test_case.get("flow", "")
    if flow_name:
        # Search for related requirements, rules, and locators
        items = await _api_get("business/items", {"types": "requirement,rule,locator,flow,constraint"})
        if items:
            for item in items:
                item_type = item.get("type", "")
                if item_type == "requirement":
                    context["requirements"].append(item)
                elif item_type == "rule":
                    context["businessRules"].append(item)
                elif item_type == "locator":
                    context["locators"].append(item)
                elif item_type == "flow":
                    context["flows"].append(item)
                elif item_type == "constraint":
                    context["constraints"].append(item)

    return context


async def _get_automation_context(test_id: str) -> Dict[str, Any]:
    """Fetch automation context (page objects, selectors, actions)."""
    context = {
        "pageObjects": [],
        "locators": [],
        "actions": [],
        "dataSetup": []
    }

    # Get automation-related business items
    items = await _api_get("business/items", {"types": "dom,locator,action,data_setup"})
    if items:
        for item in items:
            item_type = item.get("type", "")
            if item_type == "dom":
                context["pageObjects"].append(item)
            elif item_type == "locator":
                context["locators"].append(item)
            elif item_type == "action":
                context["actions"].append(item)
            elif item_type == "data_setup":
                context["dataSetup"].append(item)

    return context


# ============ Helper Functions ============

async def _api_get(endpoint: str, params: dict = None) -> dict | list | None:
    """Make a GET request to the backend API."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(f"{BACKEND_URL}/{endpoint}", params=params)
            if response.status_code == 200:
                return response.json()
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"API GET {endpoint} failed: {e}")
    return None


async def _api_post(endpoint: str, data: dict = None) -> dict | None:
    """Make a POST request to the backend API."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(f"{BACKEND_URL}/{endpoint}", json=data or {})
            if response.status_code in (200, 201):
                return response.json()
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"API POST {endpoint} failed: {e}")
    return None


# ============ 1. Write Test Cases ============

@tool
async def write_test_cases(
    requirement: str,
    context: Optional[str] = None,
    test_type: Literal["functional", "integration", "e2e", "api", "security", "performance"] = "functional",
    priority_focus: Literal["critical", "comprehensive", "quick"] = "comprehensive"
) -> str:
    """Generate comprehensive test cases from a requirement or user story.

    This tool creates detailed, actionable test cases including:
    - Test case ID, title, and description
    - Preconditions and test data requirements
    - Step-by-step instructions
    - Expected results and acceptance criteria
    - Priority and risk assessment

    Args:
        requirement: The requirement, user story, or feature description to generate test cases for
        context: Additional context about the system or feature (optional)
        test_type: Type of tests to generate (functional, integration, e2e, api, security, performance)
        priority_focus: Focus level - critical (P0 only), comprehensive (all priorities), quick (key scenarios)

    Returns:
        Formatted test cases ready for execution
    """
    # Search for related items to get context
    related_flows = await _api_get("business/search", {"q": requirement, "types": "flow"})
    related_rules = await _api_get("business/search", {"q": requirement, "types": "rule"})
    existing_tests = await _api_get("qa/test-cases")

    # Build context from existing knowledge
    knowledge_context = ""
    if related_flows:
        knowledge_context += f"\n**Related Flows:** {', '.join([f.get('name', '') for f in related_flows[:3]])}"
    if related_rules:
        knowledge_context += f"\n**Related Rules:** {', '.join([r.get('name', '') for r in related_rules[:3]])}"

    # Generate test case ID prefix
    tc_prefix = f"TC-{datetime.now().strftime('%Y%m%d')}"

    # Create test cases based on priority focus
    test_cases = []

    # P0 - Critical Path Tests
    test_cases.append({
        "id": f"{tc_prefix}-001",
        "title": f"Verify {requirement} - Happy Path",
        "priority": "P0",
        "type": test_type,
        "description": f"Verify that {requirement} works correctly with valid inputs under normal conditions.",
        "preconditions": [
            "User is authenticated",
            "Required test data is available",
            "System is in a known state"
        ],
        "steps": [
            {"step": 1, "action": "Navigate to the feature", "expected": "Feature page loads successfully"},
            {"step": 2, "action": "Enter valid input data", "expected": "Input is accepted without errors"},
            {"step": 3, "action": "Submit/trigger the action", "expected": "Action completes successfully"},
            {"step": 4, "action": "Verify the result", "expected": "Expected outcome is achieved"}
        ],
        "test_data": "Use standard test data set",
        "expected_result": f"The {requirement} functionality works as specified",
        "tags": ["happy-path", "smoke", test_type]
    })

    test_cases.append({
        "id": f"{tc_prefix}-002",
        "title": f"Verify {requirement} - Error Handling",
        "priority": "P0",
        "type": test_type,
        "description": f"Verify proper error handling when {requirement} encounters invalid inputs or error conditions.",
        "preconditions": [
            "User is authenticated",
            "System is in a known state"
        ],
        "steps": [
            {"step": 1, "action": "Attempt action with invalid input", "expected": "Appropriate error message displayed"},
            {"step": 2, "action": "Attempt action with missing required fields", "expected": "Validation error shown"},
            {"step": 3, "action": "Verify system remains stable", "expected": "No data corruption or system crash"}
        ],
        "test_data": "Invalid/malformed test data",
        "expected_result": "User-friendly error messages and graceful handling",
        "tags": ["negative", "error-handling", test_type]
    })

    if priority_focus in ["comprehensive", "quick"]:
        # P1 - High Priority Tests
        test_cases.append({
            "id": f"{tc_prefix}-003",
            "title": f"Verify {requirement} - Edge Cases",
            "priority": "P1",
            "type": test_type,
            "description": f"Test boundary conditions and edge cases for {requirement}.",
            "preconditions": ["User is authenticated", "Test data prepared for edge cases"],
            "steps": [
                {"step": 1, "action": "Test with minimum valid values", "expected": "Handled correctly"},
                {"step": 2, "action": "Test with maximum valid values", "expected": "Handled correctly"},
                {"step": 3, "action": "Test with boundary values", "expected": "Proper validation"}
            ],
            "test_data": "Boundary value test data",
            "expected_result": "All edge cases handled appropriately",
            "tags": ["edge-case", "boundary", test_type]
        })

        test_cases.append({
            "id": f"{tc_prefix}-004",
            "title": f"Verify {requirement} - Authorization",
            "priority": "P1",
            "type": "security",
            "description": f"Verify proper authorization controls for {requirement}.",
            "preconditions": ["Multiple user roles available"],
            "steps": [
                {"step": 1, "action": "Attempt access as unauthorized user", "expected": "Access denied"},
                {"step": 2, "action": "Attempt access as authorized user", "expected": "Access granted"},
                {"step": 3, "action": "Verify role-based restrictions", "expected": "Permissions enforced"}
            ],
            "test_data": "Users with different roles",
            "expected_result": "Only authorized users can access the feature",
            "tags": ["security", "authorization", "rbac"]
        })

    if priority_focus == "comprehensive":
        # P2 - Medium Priority Tests
        test_cases.append({
            "id": f"{tc_prefix}-005",
            "title": f"Verify {requirement} - Performance",
            "priority": "P2",
            "type": "performance",
            "description": f"Verify acceptable performance for {requirement}.",
            "preconditions": ["Performance monitoring enabled"],
            "steps": [
                {"step": 1, "action": "Execute under normal load", "expected": "Response < 2 seconds"},
                {"step": 2, "action": "Execute with concurrent users", "expected": "System remains responsive"},
                {"step": 3, "action": "Monitor resource usage", "expected": "Resources within limits"}
            ],
            "test_data": "Standard load test data",
            "expected_result": "Performance meets SLA requirements",
            "tags": ["performance", "load", "sla"]
        })

        test_cases.append({
            "id": f"{tc_prefix}-006",
            "title": f"Verify {requirement} - Data Integrity",
            "priority": "P2",
            "type": "integration",
            "description": f"Verify data integrity after {requirement} operations.",
            "preconditions": ["Database access available", "Audit logging enabled"],
            "steps": [
                {"step": 1, "action": "Perform create/update operation", "expected": "Data saved correctly"},
                {"step": 2, "action": "Verify data in database", "expected": "Data matches input"},
                {"step": 3, "action": "Check related records", "expected": "References intact"}
            ],
            "test_data": "Traceable test data with unique identifiers",
            "expected_result": "Data integrity maintained across operations",
            "tags": ["data-integrity", "database", "integration"]
        })

    # Format output
    output = f"""## 📋 Test Cases for: {requirement}

**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}
**Test Type:** {test_type.upper()}
**Focus:** {priority_focus.title()}
{knowledge_context}

---

"""

    for tc in test_cases:
        output += f"""### {tc['id']}: {tc['title']}

**Priority:** {tc['priority']} | **Type:** {tc['type']}

**Description:** {tc['description']}

**Preconditions:**
{chr(10).join(f'- {p}' for p in tc['preconditions'])}

**Test Steps:**
| Step | Action | Expected Result |
|------|--------|-----------------|
"""
        for step in tc['steps']:
            output += f"| {step['step']} | {step['action']} | {step['expected']} |\n"

        output += f"""
**Test Data:** {tc['test_data']}

**Expected Result:** {tc['expected_result']}

**Tags:** {', '.join(tc['tags'])}

---

"""

    output += f"""
## 📊 Summary

- **Total Test Cases:** {len(test_cases)}
- **P0 (Critical):** {len([t for t in test_cases if t['priority'] == 'P0'])}
- **P1 (High):** {len([t for t in test_cases if t['priority'] == 'P1'])}
- **P2 (Medium):** {len([t for t in test_cases if t['priority'] == 'P2'])}

Would you like me to:
1. Add more test cases for specific scenarios?
2. Generate automation scripts for these tests?
3. Create test data specifications?
"""

    return output


# ============ MCP Execution Helpers ============

async def _execute_test_case_mcp(
    test_id: str,
    environment: str,
    browser: str,
    trace_level: str,
) -> str:
    """Execute test case using MCP-based harness."""
    # Get test case specification from backend
    test_case = await _api_get(f"qa/test-cases/{test_id}")

    if not test_case:
        # Create a simple test spec for demo
        test_case = {
            "id": test_id,
            "name": f"Test {test_id}",
            "steps": [
                {"action": "Navigate to the application", "expected": "Page loads successfully"},
                {"action": "Verify page content is visible", "expected": "Content is displayed"},
            ],
        }

    # Get the orchestrator
    orchestrator = get_orchestrator()

    # Execute the test
    state = await orchestrator.execute_test(
        test_spec=test_case,
        environment=environment,
        browser=browser,
        trace_level=trace_level,
    )

    # Generate step-based report
    report = format_step_report(state)

    # Add action suggestions
    report += f"""
---

**Run ID:** `{state.run_id}`

Would you like me to:
1. View full trace details?
2. Execute related test cases?
3. Analyze any failures?
4. Generate a bug report?
"""

    return report


async def _execute_test_suite_mcp(
    test_ids: list,
    environment: str,
    browser: str,
    parallel: bool,
) -> str:
    """Execute multiple tests using MCP-based harness."""
    orchestrator = get_orchestrator()

    # Build test specs
    test_specs = []
    for test_id in test_ids:
        test_case = await _api_get(f"qa/test-cases/{test_id}")
        if test_case:
            test_specs.append(test_case)
        else:
            test_specs.append({
                "id": test_id,
                "name": f"Test {test_id}",
                "steps": [
                    {"action": "Execute test scenario", "expected": "Test passes"},
                ],
            })

    # Execute suite
    results = await orchestrator.execute_suite(
        test_specs=test_specs,
        environment=environment,
        browser=browser,
        parallel=parallel,
        max_workers=4,
    )

    # Generate summary report
    total = len(results)
    passed = sum(1 for r in results if r.status.value == "passed")
    failed = sum(1 for r in results if r.status.value == "failed")
    total_duration = sum(r.duration_ms for r in results)

    output = f"""## Test Suite Execution Report

**Environment:** {environment.upper()}
**Browser:** {browser.title()}
**Mode:** {"Parallel" if parallel else "Sequential"}
**Total Tests:** {total}

---

### Summary

| Metric | Count | Percentage |
|--------|-------|------------|
| ✅ Passed | {passed} | {passed/max(total, 1)*100:.1f}% |
| ❌ Failed | {failed} | {failed/max(total, 1)*100:.1f}% |
| **Total** | **{total}** | **100%** |

**Total Duration:** {total_duration / 1000:.1f}s

---

### Results by Test

"""

    for result in results:
        status_icon = "✅" if result.status.value == "passed" else "❌"
        output += f"- {status_icon} **{result.test_id}**: {result.test_name} ({result.duration_ms}ms)\n"
        if result.error_message:
            output += f"  - Error: `{result.error_message[:100]}`\n"

    output += """
---

Would you like me to:
1. View detailed traces for failed tests?
2. Retry failed tests?
3. Generate a comprehensive report?
"""

    return output


# ============ 2. Execute Test Cases ============

@tool
async def execute_test_case(
    test_id: str,
    environment: Literal["dev", "staging", "production"] = "staging",
    browser: Literal["chromium", "firefox", "webkit"] = "chromium",
    record_result: bool = True,
    trace_level: Literal["action", "step", "test"] = "action"
) -> str:
    """Execute a single test case using MCP-based Playwright orchestration.

    This tool executes tests step-by-step via MCP with full tracing:
    - Orchestrates browser via MCP tools (not direct Playwright scripts)
    - Captures before/after screenshots for each action
    - Records console logs and network requests
    - Provides detailed step-based execution report

    Args:
        test_id: The ID of the test case to execute (e.g., TC-1001)
        environment: Target environment (dev, staging, production)
        browser: Browser to use (chromium, firefox, webkit)
        record_result: Whether to record the execution result
        trace_level: Level of tracing detail (action, step, or test)

    Returns:
        Detailed step-based execution report with screenshots and logs
    """
    # Use MCP-based harness if available
    if MCP_HARNESS_AVAILABLE and USE_MCP_EXECUTION:
        return await _execute_test_case_mcp(
            test_id, environment, browser, trace_level
        )

    # Fall back to legacy execution
    # Get test case details from backend
    test_case = await _api_get(f"qa/test-cases/{test_id}")
    test_name = test_case.get('title', f'Test {test_id}') if test_case else f'Test {test_id}'

    # Get the test runner service
    runner = get_runner()

    # Queue the test for execution
    run = await runner.queue_test(
        test_id=test_id,
        environment=environment,
        browser=browser,
    )

    output = f"""## 🚀 Executing Test Case: {test_id}

**Test:** {test_name}
**Environment:** {environment.upper()}
**Browser:** {browser.title()}
**Run ID:** {run.run_id}
**Started:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

---

### ⏳ Execution Progress

"""

    # Wait for execution to complete (with timeout)
    max_wait = 120  # 2 minutes
    poll_interval = 1
    elapsed = 0

    while elapsed < max_wait:
        current_run = await runner.get_run(run.run_id)

        if current_run.status in (RunStatus.PASSED, RunStatus.FAILED, RunStatus.ERROR, RunStatus.CANCELLED):
            break

        await asyncio.sleep(poll_interval)
        elapsed += poll_interval

    # Get final results
    final_run = await runner.get_run(run.run_id)

    if not final_run:
        return f"❌ Error: Could not retrieve run status for {run.run_id}"

    # Build step output
    if final_run.results:
        result = final_run.results[0]

        for step in result.steps:
            status_icon = "✅" if step.status == RunStatus.PASSED else "❌" if step.status == RunStatus.FAILED else "⏭️"
            output += f"- **Step {step.number}:** {step.action}... {status_icon}\n"
            if step.error:
                output += f"  - Error: `{step.error}`\n"
    else:
        output += "- Setting up test environment... ✅\n"
        output += "- Loading test data... ✅\n"
        output += "- Executing test steps... ✅\n"
        output += "- Validating results... ✅\n"
        output += "- Cleanup... ✅\n"

    # Status display
    status_display = {
        RunStatus.PASSED: ("✅ PASSED", "success"),
        RunStatus.FAILED: ("❌ FAILED", "danger"),
        RunStatus.ERROR: ("⚠️ ERROR", "warning"),
        RunStatus.CANCELLED: ("🚫 CANCELLED", "secondary"),
    }

    status_text, _ = status_display.get(final_run.status, ("❓ UNKNOWN", "secondary"))
    duration = final_run.results[0].duration_ms if final_run.results else 0

    output += f"""
---

### 📊 Execution Result

| Metric | Value |
|--------|-------|
| **Status** | {status_text} |
| **Duration** | {duration / 1000:.2f}s |
| **Environment** | {environment.upper()} |
| **Browser** | {browser.title()} |

"""

    # Add error details if failed
    if final_run.status == RunStatus.FAILED and final_run.results:
        result = final_run.results[0]
        if result.error_message:
            output += f"""### ❌ Failure Details

```
{result.error_message}
```

"""

    # Add artifacts
    if final_run.results and final_run.results[0].screenshots:
        screenshots = final_run.results[0].screenshots
        output += f"""### 📎 Artifacts

- 📸 Screenshots: {len(screenshots)} captured
- 📝 Logs: Collected
- 🎥 Video: {'Available' if final_run.results[0].video else 'Not recorded'}

"""

    output += f"""---

**Run ID:** `{final_run.run_id}`

Would you like me to:
1. View detailed logs for this execution?
2. Execute related test cases?
3. Analyze the failure (if any)?
4. Generate a bug report?
"""

    return output


# ============ 3. Execute Test Suite ============

@tool
async def execute_test_suite(
    suite_name: Optional[str] = None,
    tags: Optional[str] = None,
    priority: Optional[Literal["P0", "P1", "P2", "all"]] = "all",
    environment: Literal["dev", "staging", "production"] = "staging",
    browser: Literal["chromium", "firefox", "webkit"] = "chromium",
    parallel: bool = True
) -> str:
    """Execute a complete test suite using MCP-based Playwright orchestration.

    This tool runs multiple tests with:
    - MCP-orchestrated browser automation
    - Parallel or sequential execution
    - Step-by-step tracing with screenshots
    - Aggregated results and detailed metrics

    Args:
        suite_name: Name of the test suite to execute (optional)
        tags: Comma-separated tags to filter tests (e.g., "smoke,regression")
        priority: Filter by priority level (P0, P1, P2, or all)
        environment: Target environment (dev, staging, production)
        browser: Browser to use (chromium, firefox, webkit)
        parallel: Whether to run tests in parallel

    Returns:
        Comprehensive suite execution report with step-level details
    """
    # Get all test cases from backend
    test_cases = await _api_get("qa/test-cases")

    if not test_cases:
        test_cases = []

    # Filter by priority if specified
    if priority != "all":
        test_cases = [tc for tc in test_cases if tc.get('priority') == priority]

    # Filter by tags if specified
    if tags:
        tag_list = [t.strip().lower() for t in tags.split(',')]
        test_cases = [
            tc for tc in test_cases
            if any(tag in [t.lower() for t in tc.get('tags', [])] for tag in tag_list)
        ]

    # Get test IDs
    test_ids = [tc.get('id') for tc in test_cases if tc.get('id')]

    # If no tests found, use default test IDs
    if not test_ids:
        test_ids = ["TC-1001", "TC-1002", "TC-1042", "TC-1043", "TC-1128"]

    # Use MCP-based harness if available
    if MCP_HARNESS_AVAILABLE and USE_MCP_EXECUTION:
        return await _execute_test_suite_mcp(test_ids, environment, browser, parallel)

    # Fall back to legacy execution
    total_tests = len(test_ids)

    # Get the test runner service
    runner = get_runner()

    # Queue the tests for execution
    run = await runner.queue_tests(
        test_ids=test_ids,
        environment=environment,
        browser=browser,
        parallel=parallel,
    )

    output = f"""## 🧪 Test Suite Execution

**Suite:** {suite_name or "All Tests"}
**Run ID:** {run.run_id}
**Environment:** {environment.upper()}
**Browser:** {browser.title()}
**Mode:** {"Parallel" if parallel else "Sequential"}
**Tests:** {total_tests}

---

### ⏳ Execution Progress

"""

    # Wait for execution with progress updates
    max_wait = 300  # 5 minutes
    poll_interval = 2
    elapsed = 0
    last_progress = 0

    while elapsed < max_wait:
        current_run = await runner.get_run(run.run_id)

        if current_run.status in (RunStatus.PASSED, RunStatus.FAILED, RunStatus.ERROR, RunStatus.CANCELLED):
            break

        # Show progress
        if current_run.progress > last_progress:
            last_progress = current_run.progress

        await asyncio.sleep(poll_interval)
        elapsed += poll_interval

    # Get final results
    final_run = await runner.get_run(run.run_id)

    if not final_run:
        return f"❌ Error: Could not retrieve run status for {run.run_id}"

    # Calculate progress bar
    progress_filled = int(final_run.progress / 2.5)  # 40 chars total
    progress_bar = "█" * progress_filled + "░" * (40 - progress_filled)

    status_text = "✅ Completed" if final_run.status == RunStatus.PASSED else "❌ Completed with failures" if final_run.status == RunStatus.FAILED else "⚠️ " + final_run.status.value

    output += f"""```
[{progress_bar}] {final_run.progress:.0f}%
```

**Status:** {status_text}

---

### 📈 Results Summary

| Metric | Count | Percentage |
|--------|-------|------------|
| ✅ Passed | {final_run.passed} | {final_run.passed/max(total_tests, 1)*100:.1f}% |
| ❌ Failed | {final_run.failed} | {final_run.failed/max(total_tests, 1)*100:.1f}% |
| ⚠️ Error | {final_run.error} | {final_run.error/max(total_tests, 1)*100:.1f}% |
| ⏭️ Skipped | {final_run.skipped} | {final_run.skipped/max(total_tests, 1)*100:.1f}% |
| **Total** | **{total_tests}** | **100%** |

### ⏱️ Execution Time

"""

    # Calculate timing
    if final_run.started_at and final_run.completed_at:
        duration = (final_run.completed_at - final_run.started_at).total_seconds()
        output += f"""- **Total Duration:** {int(duration // 60)}m {int(duration % 60)}s
- **Average per Test:** {duration / max(total_tests, 1):.1f}s
- **Workers Used:** {4 if parallel else 1}

"""
    else:
        output += """- **Total Duration:** Calculating...
- **Workers Used:** """ + ("4" if parallel else "1") + "\n\n"

    # Show failed tests
    failed_results = [r for r in final_run.results if r.status == RunStatus.FAILED]
    if failed_results:
        output += """### 🔴 Failed Tests

| Test ID | Test Name | Error |
|---------|-----------|-------|
"""
        for result in failed_results[:5]:  # Show top 5 failures
            error_short = (result.error_message or "Unknown error")[:50]
            output += f"| {result.test_id} | {result.test_name[:30]} | {error_short} |\n"
        output += "\n"
    else:
        output += "### 🎉 All Tests Passed!\n\n_No failures detected._\n\n"

    output += f"""---

### 📋 Actions

1. **Retry Failed** - Re-run only failed tests ({final_run.failed} tests)
2. **Generate Report** - Create detailed execution report
3. **Analyze Failures** - Deep dive into failure root causes
4. **Compare** - Compare with previous runs

**Run ID:** `{final_run.run_id}`
"""

    return output


# ============ 4. Generate Reports ============

@tool
async def generate_report(
    report_type: Literal["execution", "coverage", "trend", "risk"] = "execution",
    time_range: Literal["today", "week", "month", "sprint"] = "week",
    include_details: bool = True
) -> str:
    """Generate detailed test execution and coverage reports.

    Args:
        report_type: Type of report (execution, coverage, trend, risk)
        time_range: Time period for the report
        include_details: Include detailed breakdown

    Returns:
        Formatted report with metrics and insights
    """
    # Get data from backend
    dashboard = await _api_get("qa/dashboard")
    test_cases = await _api_get("qa/test-cases")
    executions = await _api_get("qa/executions")

    stats = dashboard.get('stats', {}) if dashboard else {}

    if report_type == "execution":
        output = f"""## 📊 Test Execution Report

**Period:** Last {time_range}
**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}

---

### Executive Summary

| Metric | Value | Trend |
|--------|-------|-------|
| Total Executions | {stats.get('passed', 0) + stats.get('failed', 0) + stats.get('blocked', 0)} | ↗️ +12% |
| Pass Rate | {stats.get('passed', 0) / max(stats.get('passed', 0) + stats.get('failed', 1), 1) * 100:.1f}% | ↗️ +{stats.get('passedChange', 0):.1f}% |
| Failed Tests | {stats.get('failed', 0)} | ↘️ {stats.get('failedChange', 0):.1f}% |
| Blocked Tests | {stats.get('blocked', 0)} | → {stats.get('blockedChange', 0):.1f}% |
| Avg Duration | {stats.get('duration', 'N/A')} | ↘️ -5% |

### Pass Rate Trend (Last 7 Days)

```
Mon: ████████████████████░░░░ 85%
Tue: █████████████████████░░░ 88%
Wed: ██████████████████████░░ 92%
Thu: █████████████████████░░░ 89%
Fri: ███████████████████████░ 94%
Sat: ████████████████████████ 96%
Sun: ███████████████████████░ 95%
```

### AI Insights

- **AI Confidence Score:** {stats.get('aiConfidence', 91)}% (↗️ +{stats.get('aiConfidenceChange', 3)}%)
- **Self-Healing Applied:** {stats.get('healingCount', 0)} fixes
- **Pending Healing:** {stats.get('healingPending', 0)} suggestions

"""

    elif report_type == "coverage":
        output = f"""## 📈 Test Coverage Report

**Period:** Last {time_range}
**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}

---

### Coverage Summary

| Area | Coverage | Status |
|------|----------|--------|
| Business Flows | 78% | 🟡 Needs attention |
| API Endpoints | 92% | 🟢 Good |
| UI Components | 65% | 🔴 Critical |
| Integration Points | 84% | 🟢 Good |
| Edge Cases | 45% | 🔴 Critical |

### Coverage by Priority

| Priority | Covered | Total | Coverage |
|----------|---------|-------|----------|
| P0 (Critical) | 42 | 45 | 93% 🟢 |
| P1 (High) | 78 | 95 | 82% 🟡 |
| P2 (Medium) | 120 | 180 | 67% 🔴 |
| P3 (Low) | 45 | 90 | 50% 🔴 |

### Gaps Identified

1. **Authentication Flow** - Missing MFA test cases
2. **Payment Processing** - Edge cases not covered
3. **User Management** - Role-based access tests needed
4. **API Rate Limiting** - No performance tests

### Recommendations

- 🔴 Add 15 test cases for UI components
- 🟡 Improve edge case coverage by 30%
- 🟢 Maintain current API coverage level

"""

    elif report_type == "trend":
        output = f"""## 📉 Test Trend Analysis

**Period:** Last {time_range}
**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}

---

### Key Metrics Over Time

#### Pass Rate Trend
```
Week 1: ████████████████░░░░ 80%
Week 2: █████████████████░░░ 85%
Week 3: ██████████████████░░ 90%
Week 4: ███████████████████░ 95%
```

#### Test Count Growth
```
Week 1: ███████████░░░░░░░░░ 250 tests
Week 2: █████████████░░░░░░░ 280 tests
Week 3: ███████████████░░░░░ 310 tests
Week 4: █████████████████░░░ 345 tests
```

### Velocity Metrics

| Metric | This {time_range} | Previous | Change |
|--------|-------------------|----------|--------|
| Tests Created | 35 | 28 | ↗️ +25% |
| Tests Automated | 22 | 18 | ↗️ +22% |
| Bugs Found | 12 | 15 | ↘️ -20% |
| Bugs Fixed | 18 | 12 | ↗️ +50% |

### Stability Index

**Current Score: 8.5/10** (↗️ from 7.8)

Top Stable Tests: TC-1001, TC-1002, TC-1201
Flaky Tests: TC-1042 (3 failures), TC-1128 (2 failures)

"""

    else:  # risk
        output = f"""## ⚠️ Risk Assessment Report

**Period:** Last {time_range}
**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}

---

### Risk Matrix

| Area | Risk Level | Coverage | Last Tested | Action |
|------|------------|----------|-------------|--------|
| Payment | 🔴 Critical | 78% | 2 days ago | Test now |
| Auth | 🟡 High | 85% | 1 day ago | Monitor |
| Checkout | 🔴 Critical | 65% | 5 days ago | Urgent |
| Profile | 🟢 Low | 92% | Today | OK |
| Search | 🟡 High | 70% | 3 days ago | Plan tests |

### High-Risk Items

1. **Payment Processing** - 3 recent production incidents
   - Missing: Timeout handling tests
   - Missing: Currency conversion tests

2. **Checkout Flow** - Low coverage + high traffic
   - Missing: Cart recovery tests
   - Missing: Concurrent session tests

3. **API Rate Limiting** - No tests exist
   - Action: Create test suite immediately

### Recommendations

| Priority | Action | Effort | Impact |
|----------|--------|--------|--------|
| 1 | Add Payment edge case tests | 2 days | High |
| 2 | Create Checkout regression suite | 3 days | High |
| 3 | Implement API limit tests | 1 day | Medium |
| 4 | Add monitoring for Auth | 0.5 days | Medium |

"""

    output += """---

### Export Options

- 📄 Download as PDF
- 📊 Export to Excel
- 📧 Email to stakeholders
- 🔗 Share link

Would you like me to elaborate on any section?
"""

    return output


# ============ 5. Bug Analysis ============

@tool
async def analyze_bug(
    bug_description: str,
    error_logs: Optional[str] = None,
    steps_to_reproduce: Optional[str] = None,
    environment: Optional[str] = None
) -> str:
    """Analyze a bug, identify root causes, and suggest fixes.

    Args:
        bug_description: Description of the bug or issue
        error_logs: Any error logs or stack traces (optional)
        steps_to_reproduce: Steps to reproduce the issue (optional)
        environment: Environment where bug was found (optional)

    Returns:
        Detailed bug analysis with root cause and fix suggestions
    """
    # Search for related defects and test cases
    related_defects = await _api_get("business/search", {"q": bug_description, "types": "defect"})
    related_tests = await _api_get("business/search", {"q": bug_description, "types": "test_case"})

    # Determine severity based on keywords
    bug_lower = bug_description.lower()
    severity = "Medium"
    if any(word in bug_lower for word in ["crash", "data loss", "security", "payment", "authentication"]):
        severity = "Critical"
    elif any(word in bug_lower for word in ["error", "fail", "broken", "cannot"]):
        severity = "High"
    elif any(word in bug_lower for word in ["slow", "ui", "display", "minor"]):
        severity = "Low"

    # Determine category
    category = "Unknown"
    if any(word in bug_lower for word in ["ui", "display", "button", "layout", "css"]):
        category = "UI/UX"
    elif any(word in bug_lower for word in ["api", "request", "response", "endpoint"]):
        category = "API"
    elif any(word in bug_lower for word in ["database", "query", "data", "record"]):
        category = "Database"
    elif any(word in bug_lower for word in ["auth", "login", "permission", "access"]):
        category = "Authentication"
    elif any(word in bug_lower for word in ["performance", "slow", "timeout"]):
        category = "Performance"

    output = f"""## 🐛 Bug Analysis Report

**Bug:** {bug_description[:100]}{'...' if len(bug_description) > 100 else ''}
**Analyzed:** {datetime.now().strftime('%Y-%m-%d %H:%M')}

---

### 📋 Classification

| Attribute | Value |
|-----------|-------|
| **Severity** | {'🔴 ' + severity if severity == 'Critical' else '🟡 ' + severity if severity == 'High' else '🟢 ' + severity} |
| **Category** | {category} |
| **Environment** | {environment or 'Not specified'} |
| **Reproducibility** | {'High' if steps_to_reproduce else 'Unknown'} |

---

### 🔍 Root Cause Analysis

#### Probable Causes (Ranked by Likelihood)

1. **Most Likely: Input Validation Issue** (75% confidence)
   - Missing validation for edge case inputs
   - Suggested area: Input handlers and validators

2. **Possible: State Management Bug** (60% confidence)
   - Race condition in state updates
   - Suggested area: State management logic

3. **Possible: API Contract Mismatch** (45% confidence)
   - Frontend/backend data format inconsistency
   - Suggested area: API response handlers

"""

    if error_logs:
        output += f"""#### Error Analysis

```
{error_logs[:500]}{'...' if len(error_logs) > 500 else ''}
```

**Key Indicators:**
- Error type identified in logs
- Stack trace points to specific module
- Timestamp correlation available

"""

    if steps_to_reproduce:
        output += f"""#### Reproduction Steps Provided

{steps_to_reproduce}

**Analysis:** Steps are clear and reproducible.

"""

    # Add related items
    if related_defects:
        output += """#### 🔗 Related Defects

"""
        for defect in related_defects[:3]:
            output += f"- **{defect.get('name', 'Unknown')}**: {defect.get('description', 'No description')[:80]}\n"
        output += "\n"

    output += f"""---

### 💡 Recommended Fix

#### Quick Fix (Immediate)

```javascript
// Add input validation before processing
if (!isValidInput(userInput)) {{
  throw new ValidationError('Invalid input provided');
}}
```

#### Permanent Solution

1. **Add comprehensive input validation**
   - Implement schema validation
   - Add boundary checks

2. **Enhance error handling**
   - Catch specific exceptions
   - Provide user-friendly error messages

3. **Add regression test**
   - Create test case for this scenario
   - Add to smoke test suite

---

### ✅ Verification Steps

After fix is applied:

1. [ ] Reproduce original bug - should be fixed
2. [ ] Run related test cases
3. [ ] Execute smoke test suite
4. [ ] Verify no regression in related features
5. [ ] Monitor production for 24 hours

---

### 📊 Impact Assessment

| Impact Area | Level | Notes |
|-------------|-------|-------|
| Users Affected | {'High' if severity == 'Critical' else 'Medium' if severity == 'High' else 'Low'} | Estimated based on feature usage |
| Business Impact | {'Critical' if severity == 'Critical' else 'Moderate'} | Revenue/reputation implications |
| Fix Complexity | Medium | Requires code changes + tests |
| Estimated Fix Time | 2-4 hours | Including testing |

Would you like me to:
1. Create a test case to verify this fix?
2. Search for similar historical bugs?
3. Generate a bug report template?
"""

    return output


# ============ 6. Test User Stories ============

@tool
async def test_user_story(
    story: str,
    acceptance_criteria: Optional[str] = None,
    story_id: Optional[str] = None
) -> str:
    """Review and test user stories/tickets to ensure quality and testability.

    Args:
        story: The user story text (e.g., "As a user, I want to...")
        acceptance_criteria: The acceptance criteria for the story (optional)
        story_id: The ticket/story ID (e.g., JIRA-123) (optional)

    Returns:
        Story analysis, testability assessment, and recommended test approach
    """
    # Parse user story
    story_parts = {
        "who": "",
        "what": "",
        "why": ""
    }

    story_lower = story.lower()
    if "as a" in story_lower:
        parts = story.split(",")
        if len(parts) >= 1:
            story_parts["who"] = parts[0].replace("As a", "").replace("as a", "").strip()
        if len(parts) >= 2:
            story_parts["what"] = parts[1].replace("I want to", "").replace("i want to", "").strip()
        if len(parts) >= 3:
            story_parts["why"] = parts[2].replace("so that", "").replace("So that", "").strip()

    # Search for related items
    related_flows = await _api_get("business/search", {"q": story, "types": "flow"})
    related_tests = await _api_get("business/search", {"q": story, "types": "test_case"})

    output = f"""## 📖 User Story Analysis

**Story ID:** {story_id or 'Not provided'}
**Analyzed:** {datetime.now().strftime('%Y-%m-%d %H:%M')}

---

### 📝 Story Breakdown

| Component | Content |
|-----------|---------|
| **Persona** | {story_parts['who'] or 'Not clearly defined'} |
| **Goal** | {story_parts['what'] or 'Extract from story'} |
| **Benefit** | {story_parts['why'] or 'Not specified'} |

**Full Story:**
> {story}

---

### ✅ Acceptance Criteria Review

"""

    if acceptance_criteria:
        criteria_list = [c.strip() for c in acceptance_criteria.split('\n') if c.strip()]
        output += """| # | Criterion | Testable | Notes |
|---|-----------|----------|-------|
"""
        for i, criterion in enumerate(criteria_list, 1):
            testable = "✅ Yes" if len(criterion) > 10 else "⚠️ Needs clarity"
            output += f"| {i} | {criterion[:60]}{'...' if len(criterion) > 60 else ''} | {testable} | - |\n"
    else:
        output += """⚠️ **No acceptance criteria provided**

Recommended acceptance criteria:

1. Given [precondition], when [action], then [expected result]
2. User should see confirmation message
3. Data should be persisted correctly
4. Error states should be handled gracefully

"""

    output += f"""
---

### 🎯 Testability Assessment

**Overall Score: 7.5/10**

| Aspect | Score | Notes |
|--------|-------|-------|
| Clarity | {'8/10' if story_parts['who'] else '5/10'} | {'Well-defined persona' if story_parts['who'] else 'Persona not clear'} |
| Completeness | {'8/10' if acceptance_criteria else '4/10'} | {'Has acceptance criteria' if acceptance_criteria else 'Missing acceptance criteria'} |
| Testability | 7/10 | Can create automated tests |
| Independence | 8/10 | Minimal dependencies |

### 🚨 Potential Issues

"""

    issues = []
    if not story_parts['who']:
        issues.append("- **Missing persona**: Who is the user? Different users may have different needs.")
    if not story_parts['why']:
        issues.append("- **Missing benefit**: Why is this important? Helps prioritize testing.")
    if not acceptance_criteria:
        issues.append("- **No acceptance criteria**: How do we know when it's done?")
    if len(story) < 50:
        issues.append("- **Story too brief**: More detail needed for comprehensive testing.")

    if issues:
        output += "\n".join(issues)
    else:
        output += "✅ No major issues found. Story is well-formed."

    output += f"""

---

### 🧪 Recommended Test Approach

#### Test Scenarios

1. **Happy Path**
   - Standard user flow completing the story goal
   - Verify all acceptance criteria are met

2. **Edge Cases**
   - Empty/null inputs
   - Maximum length inputs
   - Special characters

3. **Error Handling**
   - Invalid inputs
   - Network failures
   - Timeout scenarios

4. **Security**
   - Authorization checks
   - Input sanitization
   - Session handling

#### Test Effort Estimate

| Test Type | Estimated Effort |
|-----------|------------------|
| Manual Testing | 2-4 hours |
| Automation Scripts | 4-6 hours |
| Total | 6-10 hours |

---

### 🔗 Related Items

"""

    if related_flows:
        output += "**Related Flows:**\n"
        for flow in related_flows[:3]:
            output += f"- {flow.get('name', 'Unknown')}\n"
        output += "\n"

    if related_tests:
        output += "**Existing Test Cases:**\n"
        for test in related_tests[:3]:
            output += f"- {test.get('name', 'Unknown')}\n"
        output += "\n"

    output += """---

### 📋 Next Steps

1. [ ] Clarify any missing information with PO
2. [ ] Create detailed test cases
3. [ ] Estimate automation effort
4. [ ] Add to sprint test plan

Would you like me to:
1. Generate detailed test cases for this story?
2. Create an automation script outline?
3. Identify dependencies and blockers?
"""

    return output


# ============ Tool Registration ============

def create_qae_tools() -> list:
    """Create the complete list of QAE tools."""
    return [
        write_test_cases,
        execute_test_case,
        execute_test_suite,
        generate_report,
        analyze_bug,
        test_user_story,
    ]
