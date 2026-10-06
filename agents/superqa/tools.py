"""Tools for the Super QA agent to control the platform."""
import os
import json
import httpx
from langchain_core.tools import tool
from typing import Literal

BACKEND_URL = os.getenv("BACKEND_API_URL", "http://localhost:4000/api")
# Self-referential base URL for this same FastAPI process, so SuperQA can hold a real
# conversational turn with QAE/AUE's own chat endpoint (full system prompt, tools, and
# reasoning loop) rather than only the narrower, skill-only delegate_qa_skill shortcut.
AGENTS_SELF_URL = os.getenv("AGENTS_SELF_URL", f"http://localhost:{os.getenv('PORT', '8000')}")


@tool
def list_qa_skills(agent_type: Literal["qae", "aue"], skill_name: str = "") -> str:
    """List an expert's QA skills; provide skill_name to retrieve its exact input schema."""
    from shared.skills.registry import catalog, get_skill
    if skill_name:
        return json.dumps(get_skill(skill_name, agent_type).manifest())
    return json.dumps([{key: value for key, value in skill.items() if key != "input_schema"}
                       for skill in catalog(agent_type)])


@tool
async def delegate_qa_skill(agent_type: Literal["qae", "aue"], skill_name: str, inputs: dict,
                            request_id: str = "", allow_model: bool = False) -> str:
    """Delegate a bounded skill request to QAE/AUE. Discover its schema first; reuse request_id on retries."""
    from uuid import uuid4
    from shared.skills.contracts import SkillRequest, requires_request_id
    from shared.skills.registry import get_skill
    from qae.agent import create_qae_agent
    from aue.agent import create_aue_agent
    skill = get_skill(skill_name, agent_type)
    if requires_request_id(skill_name, inputs) and not request_id:
        raise ValueError("Browser execution, login, and interactions require a stable request_id UUID")
    request = SkillRequest(request_id=request_id or str(uuid4()), agent_type=agent_type, skill=skill_name,
                           inputs=inputs, allow_model=allow_model)
    from langgraph.config import get_stream_writer
    expert = create_qae_agent() if agent_type == "qae" else create_aue_agent()
    state = {"messages": [], "agent_type": agent_type, "skill_request": request.model_dump(mode="json")}
    try:
        writer = get_stream_writer()
    except (RuntimeError, KeyError):
        def writer(_chunk):
            return None
    async for mode, chunk in expert.astream(state, stream_mode=["updates", "custom"]):
        if mode == "custom":
            writer(chunk)
            continue
        for update in chunk.values():
            state.update(update)
    return json.dumps(state["skill_result"], ensure_ascii=False)


# ============ Console-Session Delegation Tools ============
#
# delegate_qa_skill (above) invokes one named, structured skill and skips straight
# past QAE/AUE's own system prompt and reasoning loop. These tools instead open a
# real console session against QAE/AUE's actual chat endpoint — the same one their
# own UI uses — so SuperQA can hold a free-form conversational back-and-forth, run
# several sessions concurrently, and read any of them back on demand.

@tool
async def start_agent_session(agent_type: Literal["qae", "aue"]) -> str:
    """Start a new console session with QAE or AUE for free-form delegation.

    Use this (not delegate_qa_skill) when you need an open-ended conversation rather
    than one named structured workflow. Returns a session_id to use with ask_agent
    and read_agent_session. You may hold several sessions open at once.
    """
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            response = await client.post(f"{AGENTS_SELF_URL}/agents/{agent_type}/sessions")
            if response.status_code not in (200, 201):
                return f"❌ Failed to start a {agent_type.upper()} session: {response.text}"
            session = response.json()
            return f"✅ Started a {agent_type.upper()} console session.\n\n**session_id:** {session['id']}"
        except Exception as e:
            return f"❌ Error starting {agent_type.upper()} session: {str(e)}"


@tool
async def ask_agent(agent_type: Literal["qae", "aue"], session_id: str, message: str) -> str:
    """Send a message into an open QAE/AUE console session and return its reply.

    The target agent reasons with its own full system prompt, tools, and skills —
    this is a real conversational turn, not a shortcut. Use start_agent_session first
    to get a session_id. Expect this to take longer than a simple platform tool call
    when the agent needs to use tools itself.
    """
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            response = await client.post(
                f"{AGENTS_SELF_URL}/agents/{agent_type}/chat",
                json={"message": message, "sessionId": session_id},
            )
            if response.status_code == 403:
                return f"❌ That session_id does not belong to {agent_type.upper()}; start a new session for this agent type."
            if response.status_code != 200:
                return f"❌ {agent_type.upper()} session error: {response.text}"
            data = response.json()
            return data.get("response", "")
        except Exception as e:
            return f"❌ Error messaging {agent_type.upper()} session: {str(e)}"


@tool
async def read_agent_session(session_id: str) -> str:
    """Read the full transcript of a QAE/AUE console session started with start_agent_session."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            response = await client.get(f"{AGENTS_SELF_URL}/sessions/{session_id}")
            if response.status_code == 404:
                return "❌ Session not found. It may have expired or the ID is wrong."
            if response.status_code != 200:
                return f"❌ Error reading session: {response.text}"
            session = response.json()
            lines = [f"**{session['agentType'].upper()} session** · status: {session['status']}\n"]
            for message in session.get("messages", []):
                role = message.get("role", "?")
                lines.append(f"**{role}:** {message.get('content', '')}")
            return "\n\n".join(lines) if len(lines) > 1 else "This session has no messages yet."
        except Exception as e:
            return f"❌ Error reading session: {str(e)}"


@tool
async def list_agent_sessions(agent_type: Literal["qae", "aue", "all"] = "all") -> str:
    """List open/recent QAE/AUE console sessions, so you can find a session_id you started earlier."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            agent_types = ["qae", "aue"] if agent_type == "all" else [agent_type]
            lines = []
            for current in agent_types:
                response = await client.get(f"{AGENTS_SELF_URL}/agents/{current}/sessions")
                if response.status_code != 200:
                    continue
                for session in response.json():
                    lines.append(f"- **{current.upper()}** · `{session['id']}` · {session['status']} · {session.get('messageCount', 0)} message(s)")
            if not lines:
                return "No open console sessions found."
            return "**Console sessions:**\n\n" + "\n".join(lines)
        except Exception as e:
            return f"❌ Error listing sessions: {str(e)}"


# ============ Task Management Tools ============

@tool
async def create_task(
    title: str,
    agent_type: Literal["qae", "aue"],
    description: str = "",
    priority: Literal["urgent", "high", "medium", "low"] = "medium",
    labels: str = "",
) -> str:
    """Create a new task for an agent.

    Args:
        title: The task title
        agent_type: Which agent to assign - 'qae' for QA Engineer, 'aue' for Automation Engineer
        description: Optional task description
        priority: Task priority - urgent, high, medium, or low
        labels: Comma-separated labels (e.g., "regression,api,critical")

    Returns:
        Confirmation message with task details
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            label_list = [l.strip() for l in labels.split(",") if l.strip()] if labels else []
            response = await client.post(
                f"{BACKEND_URL}/agents/{agent_type}/tasks",
                json={
                    "title": title,
                    "description": description or None,
                    "priority": priority,
                    "labels": label_list,
                },
            )
            if response.status_code in (200, 201):
                task = response.json()
                agent_name = "QA Engineer" if agent_type == "qae" else "Automation Engineer"
                return f"✅ Task created successfully!\n\n**Task:** {task.get('title')}\n**Agent:** {agent_name}\n**Priority:** {priority}\n**ID:** {task.get('id')}"
            return f"❌ Failed to create task: {response.text}"
        except Exception as e:
            return f"❌ Error creating task: {str(e)}"


@tool
async def list_tasks(
    agent_type: Literal["qae", "aue", "all"] = "all",
    status: Literal["todo", "in_progress", "done", "blocked", "cancelled", "all"] = "all",
) -> str:
    """List tasks with optional filters.

    Args:
        agent_type: Filter by agent - 'qae', 'aue', or 'all'
        status: Filter by status - todo, in_progress, done, blocked, cancelled, or all

    Returns:
        Formatted list of tasks
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            tasks = []
            agents = ["qae", "aue"] if agent_type == "all" else [agent_type]

            for agent in agents:
                url = f"{BACKEND_URL}/agents/{agent}/tasks"
                if status != "all":
                    url += f"?status={status}"
                response = await client.get(url)
                if response.status_code == 200:
                    tasks.extend(response.json())

            if not tasks:
                return "No tasks found matching the criteria."

            result = f"**Found {len(tasks)} task(s):**\n\n"
            for task in tasks[:10]:  # Limit to 10
                agent_badge = "🔍 QAE" if task.get("agentType") == "qae" else "🤖 AUE"
                status_emoji = {
                    "todo": "⬜",
                    "in_progress": "🔄",
                    "done": "✅",
                    "blocked": "🚫",
                    "cancelled": "❌",
                }.get(task.get("status"), "❓")
                result += f"{status_emoji} **{task.get('title')}** ({agent_badge})\n"
                result += f"   Priority: {task.get('priority')} | Status: {task.get('status')}\n\n"

            if len(tasks) > 10:
                result += f"_...and {len(tasks) - 10} more tasks_"

            return result
        except Exception as e:
            return f"❌ Error listing tasks: {str(e)}"


@tool
async def start_task(task_id: str) -> str:
    """Start working on a task (changes status to in_progress).

    Args:
        task_id: The ID of the task to start

    Returns:
        Confirmation message
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.post(f"{BACKEND_URL}/agents/tasks/{task_id}/start")
            if response.status_code == 200:
                task = response.json()
                return f"✅ Task started: **{task.get('title')}**\n\nA new session has been created for this task."
            return f"❌ Failed to start task: {response.text}"
        except Exception as e:
            return f"❌ Error starting task: {str(e)}"


@tool
async def complete_task(task_id: str, summary: str = "") -> str:
    """Mark a task as completed.

    Args:
        task_id: The ID of the task to complete
        summary: Optional summary of what was accomplished

    Returns:
        Confirmation message
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.post(
                f"{BACKEND_URL}/agents/tasks/{task_id}/complete",
                json={"summary": summary} if summary else {},
            )
            if response.status_code == 200:
                task = response.json()
                return f"✅ Task completed: **{task.get('title')}**"
            return f"❌ Failed to complete task: {response.text}"
        except Exception as e:
            return f"❌ Error completing task: {str(e)}"


@tool
async def block_task(task_id: str, reason: str) -> str:
    """Block a task with a reason.

    Args:
        task_id: The ID of the task to block
        reason: Why the task is blocked

    Returns:
        Confirmation message
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.post(
                f"{BACKEND_URL}/agents/tasks/{task_id}/block",
                json={"reason": reason},
            )
            if response.status_code == 200:
                task = response.json()
                return f"🚫 Task blocked: **{task.get('title')}**\n\nReason: {reason}"
            return f"❌ Failed to block task: {response.text}"
        except Exception as e:
            return f"❌ Error blocking task: {str(e)}"


# ============ Sync Management Tools ============

@tool
async def list_sources() -> str:
    """List all connected data sources.

    Returns:
        Formatted list of sources with their status
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.get(f"{BACKEND_URL}/sources")
            if response.status_code == 200:
                sources = response.json()
                if not sources:
                    return "No sources connected yet. Add sources to start syncing data."

                result = f"**Connected Sources ({len(sources)}):**\n\n"
                for source in sources:
                    status_emoji = {
                        "connected": "🟢",
                        "syncing": "🔄",
                        "error": "🔴",
                        "disconnected": "⚪",
                    }.get(source.get("status"), "❓")
                    result += f"{status_emoji} **{source.get('name')}** ({source.get('type')})\n"
                    result += f"   Status: {source.get('status')} | Items: {source.get('itemsCount', 0)}\n"
                    if source.get("lastSync"):
                        result += f"   Last sync: {source.get('lastSync')}\n"
                    result += "\n"
                return result
            return f"❌ Failed to list sources: {response.text}"
        except Exception as e:
            return f"❌ Error listing sources: {str(e)}"


@tool
async def start_sync(source_id: str) -> str:
    """Start a sync job for a data source.

    Args:
        source_id: The ID of the source to sync

    Returns:
        Confirmation message with sync job details
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.post(f"{BACKEND_URL}/sources/{source_id}/sync")
            if response.status_code in (200, 201, 202):
                job = response.json()
                return f"🔄 Sync started!\n\n**Job ID:** {job.get('id')}\n**Status:** {job.get('status')}\n\nThe sync is running in the background. Use `check_sync_status` to monitor progress."
            return f"❌ Failed to start sync: {response.text}"
        except Exception as e:
            return f"❌ Error starting sync: {str(e)}"


@tool
async def check_sync_status(source_id: str) -> str:
    """Check the sync status for a source.

    Args:
        source_id: The ID of the source to check

    Returns:
        Current sync status and recent job info
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.get(f"{BACKEND_URL}/sources/{source_id}/jobs?limit=1")
            if response.status_code == 200:
                jobs = response.json()
                if not jobs:
                    return "No sync jobs found for this source."

                job = jobs[0]
                status_emoji = {
                    "completed": "✅",
                    "running": "🔄",
                    "failed": "❌",
                    "queued": "⏳",
                }.get(job.get("status"), "❓")

                result = f"**Latest Sync Job:**\n\n"
                result += f"{status_emoji} Status: {job.get('status')}\n"
                if job.get("currentStage"):
                    result += f"Current stage: {job.get('currentStage')}\n"
                if job.get("stats"):
                    stats = job["stats"]
                    result += f"\n**Stats:**\n"
                    result += f"- Documents: {stats.get('documentsTotal', 0)}\n"
                    result += f"- New: {stats.get('documentsNew', 0)}\n"
                    result += f"- Updated: {stats.get('documentsUpdated', 0)}\n"
                    result += f"- Business items extracted: {stats.get('businessItemsExtracted', 0)}\n"
                return result
            return f"❌ Failed to check sync status: {response.text}"
        except Exception as e:
            return f"❌ Error checking sync status: {str(e)}"


# ============ Environment Tools ============

@tool
async def list_environments() -> str:
    """List all configured environments.

    Returns:
        Formatted list of environments
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.get(f"{BACKEND_URL}/environments")
            if response.status_code == 200:
                envs = response.json()
                if not envs:
                    return "No environments configured yet."

                result = f"**Environments ({len(envs)}):**\n\n"
                for env in envs:
                    default_badge = " (default)" if env.get("isDefault") else ""
                    result += f"🌍 **{env.get('name')}**{default_badge}\n"
                    if env.get("description"):
                        result += f"   {env.get('description')}\n"
                    var_count = len(env.get("variables", []))
                    result += f"   Variables: {var_count}\n\n"
                return result
            return f"❌ Failed to list environments: {response.text}"
        except Exception as e:
            return f"❌ Error listing environments: {str(e)}"


@tool
async def create_environment(
    name: str,
    description: str = "",
    color: str = "#3B82F6",
    is_default: bool = False,
) -> str:
    """Create a new environment.

    Args:
        name: Environment name (e.g., 'staging', 'production')
        description: Optional description
        color: Hex color code for the environment
        is_default: Whether this should be the default environment

    Returns:
        Confirmation message
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            response = await client.post(
                f"{BACKEND_URL}/environments",
                json={
                    "name": name,
                    "description": description or None,
                    "color": color,
                    "isDefault": is_default,
                    "variables": [],
                },
            )
            if response.status_code in (200, 201):
                env = response.json()
                return f"✅ Environment created: **{env.get('name')}**\n\nID: {env.get('id')}"
            return f"❌ Failed to create environment: {response.text}"
        except Exception as e:
            return f"❌ Error creating environment: {str(e)}"


@tool
async def add_environment_variable(
    environment_id: str,
    key: str,
    value: str,
    is_secret: bool = False,
) -> str:
    """Add a variable to an environment.

    Args:
        environment_id: The environment ID
        key: Variable name
        value: Variable value
        is_secret: Whether this is a secret (will be masked in UI)

    Returns:
        Confirmation message
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            # First get the environment
            response = await client.get(f"{BACKEND_URL}/environments/{environment_id}")
            if response.status_code != 200:
                return f"❌ Environment not found"

            env = response.json()
            variables = env.get("variables", [])

            # Add or update variable
            found = False
            for var in variables:
                if var["key"] == key:
                    var["value"] = value
                    var["isSecret"] = is_secret
                    found = True
                    break

            if not found:
                variables.append({"key": key, "value": value, "isSecret": is_secret})

            # Update environment
            response = await client.patch(
                f"{BACKEND_URL}/environments/{environment_id}",
                json={"variables": variables},
            )
            if response.status_code == 200:
                action = "updated" if found else "added"
                masked_value = "********" if is_secret else value
                return f"✅ Variable {action}: **{key}** = `{masked_value}`"
            return f"❌ Failed to update environment: {response.text}"
        except Exception as e:
            return f"❌ Error adding variable: {str(e)}"


# ============ Business Knowledge Tools ============

@tool
async def search_knowledge(
    query: str,
    item_type: str = "",
) -> str:
    """Search the business knowledge base.

    Args:
        query: Search query
        item_type: Optional type filter (flow, rule, test_case, requirement, defect, etc.)

    Returns:
        Search results
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            params = {"q": query}
            if item_type:
                params["types"] = item_type

            response = await client.get(f"{BACKEND_URL}/business/search", params=params)
            if response.status_code == 200:
                items = response.json()
                if not items:
                    return f"No results found for '{query}'"

                result = f"**Found {len(items)} result(s):**\n\n"
                for item in items[:8]:
                    type_emoji = {
                        "flow": "🔄",
                        "rule": "📜",
                        "test_case": "🧪",
                        "requirement": "📋",
                        "defect": "🐛",
                        "fact": "💡",
                        "entity": "📦",
                    }.get(item.get("type"), "📄")
                    result += f"{type_emoji} **{item.get('name')}** ({item.get('type')})\n"
                    if item.get("description"):
                        desc = item["description"][:100] + "..." if len(item.get("description", "")) > 100 else item.get("description")
                        result += f"   {desc}\n"
                    result += "\n"

                if len(items) > 8:
                    result += f"_...and {len(items) - 8} more results_"
                return result
            return f"❌ Failed to search: {response.text}"
        except Exception as e:
            return f"❌ Error searching: {str(e)}"


@tool
async def get_platform_stats() -> str:
    """Get overall platform statistics.

    Returns:
        Platform statistics including tasks, sources, and business items
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            # Gather stats from multiple endpoints
            results = {}

            # Task stats
            try:
                qae_stats = await client.get(f"{BACKEND_URL}/agents/qae/tasks/stats")
                aue_stats = await client.get(f"{BACKEND_URL}/agents/aue/tasks/stats")
                if qae_stats.status_code == 200 and aue_stats.status_code == 200:
                    qae = qae_stats.json()
                    aue = aue_stats.json()
                    results["tasks"] = {
                        "total": sum(qae.values()) + sum(aue.values()),
                        "in_progress": qae.get("in_progress", 0) + aue.get("in_progress", 0),
                        "done": qae.get("done", 0) + aue.get("done", 0),
                        "blocked": qae.get("blocked", 0) + aue.get("blocked", 0),
                    }
            except:
                pass

            # Business stats
            try:
                biz_resp = await client.get(f"{BACKEND_URL}/business/stats")
                if biz_resp.status_code == 200:
                    results["business"] = biz_resp.json()
            except:
                pass

            # Source count
            try:
                src_resp = await client.get(f"{BACKEND_URL}/sources")
                if src_resp.status_code == 200:
                    results["sources"] = len(src_resp.json())
            except:
                pass

            # Format output
            output = "**Platform Statistics:**\n\n"

            if "tasks" in results:
                t = results["tasks"]
                output += f"📋 **Tasks:** {t['total']} total\n"
                output += f"   - In Progress: {t['in_progress']}\n"
                output += f"   - Completed: {t['done']}\n"
                output += f"   - Blocked: {t['blocked']}\n\n"

            if "sources" in results:
                output += f"🔗 **Sources:** {results['sources']} connected\n\n"

            if "business" in results:
                b = results["business"]
                output += f"📚 **Business Items:** {b.get('total', 0)} total\n"
                if b.get("byType"):
                    for item_type, count in list(b["byType"].items())[:5]:
                        output += f"   - {item_type}: {count}\n"

            return output
        except Exception as e:
            return f"❌ Error getting stats: {str(e)}"


@tool
def get_help(topic: str = "") -> str:
    """Get help about using the platform.

    Args:
        topic: Optional topic to get help on (tasks, agents, sources, environments, etc.)

    Returns:
        Help information
    """
    help_topics = {
        "tasks": """**Task Management Help:**

Tasks are work items assigned to agents (QAE or AUE).

**Commands:**
- Create a task: "Create a task for QAE to design test cases for login"
- List tasks: "Show all in-progress tasks"
- Start a task: "Start task [task-id]"
- Complete a task: "Complete task [task-id]"
- Block a task: "Block task [task-id] because waiting for API docs"

**Task Statuses:** todo, in_progress, done, blocked, cancelled
**Priorities:** urgent, high, medium, low""",

        "agents": """**Agent Help:**

Two specialized agents are available:

🔍 **QA Engineer (QAE)**
- Test case design
- Exploratory testing analysis
- Risk assessment
- Bug analysis

🤖 **Automation Engineer (AUE)**
- Script generation (Playwright, Cypress)
- Locator strategies
- Debugging test failures
- Framework setup

**Usage:** Assign tasks to the appropriate agent based on the work type.""",

        "sources": """**Sources Help:**

Sources are external data connections that sync content into the platform.

**Supported Sources:**
- GitHub (code, PRs, issues)
- Jira (tickets, requirements)
- Confluence (documentation)
- Postman/Swagger (API specs)
- And more...

**Commands:**
- "List all sources"
- "Start sync for source [source-id]"
- "Check sync status for [source-id]" """,

        "environments": """**Environments Help:**

Environments store configuration for different deployment targets.

**Common Environments:**
- Development
- Staging
- Production

**Commands:**
- "List environments"
- "Create a staging environment"
- "Add variable API_URL to environment [env-id]" """,
    }

    if topic.lower() in help_topics:
        return help_topics[topic.lower()]

    return """**Super QA Help:**

I can help you with anything on this platform! Here are the main areas:

📋 **Tasks** - Create and manage work items for agents
🤖 **Agents** - QA Engineer and Automation Engineer bots
🔗 **Sources** - External data connections and syncing
🌍 **Environments** - Configuration management
📚 **Knowledge** - Search business rules, flows, test cases

**Try asking:**
- "Create a task for the QA Engineer to design test cases for checkout"
- "List all in-progress tasks"
- "Start sync for the GitHub source"
- "Search for payment related flows"
- "Show platform statistics"

Type `get_help("topic")` for detailed help on: tasks, agents, sources, environments"""


def _role_scoped_job_tools(role: str) -> list:
    """The create_skill_tools(role) extras not already covered, generically across
    both roles, by list_qa_skills/delegate_qa_skill above: per-run artifact lookup,
    configured-resource discovery, and execution-job status/cancel. list_skills and
    run_skill are deliberately excluded — list_qa_skills/delegate_qa_skill already do
    that same job for either role via an agent_type parameter, and including both
    would register two differently-scoped tools under the identical names
    "list_skills"/"run_skill", colliding when QAE's and AUE's sets are combined."""
    from shared.skills.tools import create_skill_tools
    extras = {"get_skill_run", "list_workflow_resources", "get_execution_job", "cancel_execution_job"}
    return [tool.model_copy(update={"name": f"{role}_{tool.name}"}) for tool in create_skill_tools(role) if tool.name in extras]


def create_superqa_tools() -> list:
    """Create tools list for Super QA agent: platform tools plus full QAE/AUE access —
    the structured skill shortcut, real console-session delegation, and QAE/AUE's own
    job-status/resource-discovery tools, role-prefixed so both sets coexist."""
    return [
        list_qa_skills,
        delegate_qa_skill,
        # Console-session delegation (free-form, concurrent, readable-back)
        start_agent_session,
        ask_agent,
        read_agent_session,
        list_agent_sessions,
        # Task Management
        create_task,
        list_tasks,
        start_task,
        complete_task,
        block_task,
        # Sync Management
        list_sources,
        start_sync,
        check_sync_status,
        # Environment Management
        list_environments,
        create_environment,
        add_environment_variable,
        # Knowledge
        search_knowledge,
        get_platform_stats,
        get_help,
        # QAE + AUE's own job-status/resource-discovery tools, role-prefixed
        *_role_scoped_job_tools("qae"),
        *_role_scoped_job_tools("aue"),
    ]
