"""Stdio MCP transport for QA workflows. Requires requirements-mcp.txt / Python 3.10+."""
import asyncio
import json
import os

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import CallToolResult, TextContent, Tool

from shared.skills.tools import create_skill_tools


def create_server(role="qae", runtime=None):
    if role not in ("qae", "aue"):
        raise ValueError("QA_MCP_ROLE must be qae or aue")
    server = Server("superqa-skills-" + role)
    tools = {tool.name: tool for tool in create_skill_tools(role, runtime)}

    @server.list_tools()
    async def list_tools():
        return [Tool(name=tool.name, description=tool.description,
                     inputSchema=tool.get_input_schema().model_json_schema())
                for tool in tools.values()]

    @server.call_tool()
    async def call_tool(name, arguments):
        try:
            if name not in tools:
                raise ValueError("Unknown tool; use list_skills and run_skill for QA workflows")
            result = json.loads(await tools[name].ainvoke(dict(arguments or {})))
            return CallToolResult(content=[TextContent(type="text", text=json.dumps(result, ensure_ascii=False))],
                                  isError=isinstance(result, dict) and result.get("status") in ("blocked", "failed", "interrupted", "not_found"))
        except Exception as error:
            message = str(error)[:500] if isinstance(error, ValueError) else "Workflow capability failed (" + type(error).__name__ + ")"
            return CallToolResult(content=[TextContent(type="text", text=message)], isError=True)

    return server


async def run_server():
    from dotenv import load_dotenv
    load_dotenv()
    server = create_server(os.getenv("QA_MCP_ROLE", "qae"))
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(run_server())
