"""Settings describe registered tools and provider-discovered models."""
import asyncio
import os
import time

import httpx

from .llm import LLMConfig, selected_model, temperature_override, MIN_TEMPERATURE, MAX_TEMPERATURE
from .skills.agent import DEFAULT_MAX_ITERATIONS, MAX_MAX_ITERATIONS, MIN_MAX_ITERATIONS
from .skills.registry import SKILLS, catalog

_cache = None
_cached_at = 0.0


def registered_tools(role):
    if role == "qae":
        from qae.tools import create_qae_tools
        return create_qae_tools()
    if role == "aue":
        from shared.tools import create_tools
        return create_tools("aue")
    from superqa.tools import create_superqa_tools
    return create_superqa_tools()


def chat_model(model):
    # /models includes image, audio, embedding and Responses-only models too.
    return (model.startswith(("gpt-", "chatgpt-", "o1", "o3", "o4", "ft:gpt-"))
            and not any(part in model for part in ("audio", "realtime", "image", "transcribe", "search", "deep-research", "-pro", "codex", "instruct", "0314", "0301")))


async def discover_provider(provider):
    key = os.getenv({"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}.get(provider, ""))
    result = {"id": provider, "models": [], "error": None}
    if provider != "ollama" and not key:
        return {**result, "error": "Provider credentials are not configured"}
    try:
        async with httpx.AsyncClient(timeout=5, follow_redirects=False) as client:
            if provider == "openai":
                base = os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1"
                response = await client.get(base.rstrip("/") + "/models", headers={"Authorization": "Bearer " + key})
                response.raise_for_status()
                result["models"] = sorted({item["id"] for item in response.json()["data"] if chat_model(item["id"])})
            elif provider == "anthropic":
                base = os.getenv("ANTHROPIC_BASE_URL") or "https://api.anthropic.com"
                after = None
                models = set()
                for _ in range(10):
                    response = await client.get(base.rstrip("/") + "/v1/models",
                        headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
                        params={"limit": 100, **({"after_id": after} if after else {})})
                    response.raise_for_status()
                    page = response.json()
                    models.update(item["id"] for item in page["data"])
                    if not page.get("has_more"):
                        break
                    after = page["last_id"]
                result["models"] = sorted(models)
            else:
                base = os.getenv("OLLAMA_BASE_URL") or "http://localhost:11434"
                response = await client.get(base.rstrip("/") + "/api/tags")
                response.raise_for_status()
                names = [item["name"] for item in response.json()["models"]][:100]
                async def supports_tools(name):
                    detail = await client.post(base.rstrip("/") + "/api/show", json={"model": name})
                    detail.raise_for_status()
                    return name if "tools" in detail.json().get("capabilities", []) else None
                result["models"] = sorted(name for name in await asyncio.gather(*(supports_tools(name) for name in names)) if name)
    except Exception:
        result["error"] = "Could not load models from this provider"
        result["models"] = []
    return result


async def model_catalog():
    global _cache, _cached_at
    if _cache is None or time.monotonic() - _cached_at >= 30:
        async def bounded(provider):
            try:
                return await asyncio.wait_for(discover_provider(provider), timeout=8)
            except asyncio.TimeoutError:
                return {"id": provider, "models": [], "error": "Model discovery timed out"}
        _cache = await asyncio.gather(*(bounded(provider) for provider in ("openai", "anthropic", "ollama")))
        _cached_at = time.monotonic()
    return _cache


async def settings_for(role):
    tools = registered_tools(role)
    names = {tool.name for tool in tools}
    skills = catalog(role) if "run_skill" in names else []
    operations = {}
    for skill in skills:
        for item in SKILLS[skill["name"]].operations:
            if item.name in names:
                raise ValueError("Workflow operation collides with a direct agent tool: " + item.name)
            entry = operations.setdefault(item.name, {"name": item.name, "description": item.description,
                                                       "access": "workflow", "usedBy": []})
            entry["usedBy"].append(skill["name"])
    with selected_model(role, None), temperature_override(role, None):
        default = LLMConfig.from_env(role)
    return {"agentType": role,
            "skills": [{"name": item["name"], "description": item["description"], "modelPolicy": item["model_policy"], "toolNames": item["tools"]}
                       for item in skills],
            "tools": [*operations.values(), *[{"name": tool.name, "description": tool.description,
                                              "access": "agent", "usedBy": []} for tool in tools]],
            "defaultModel": {"provider": default.provider.value, "model": default.model},
            "providers": await model_catalog(),
            "defaultMaxIterations": DEFAULT_MAX_ITERATIONS,
            "minMaxIterations": MIN_MAX_ITERATIONS,
            "maxMaxIterations": MAX_MAX_ITERATIONS,
            "defaultTemperature": default.temperature,
            "minTemperature": MIN_TEMPERATURE,
            "maxTemperature": MAX_TEMPERATURE}
