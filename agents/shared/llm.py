"""LLM Provider - Supports OpenAI, Anthropic, and Ollama."""
import os
import logging
from enum import Enum
from typing import Optional, List, Any
from dataclasses import dataclass
from contextlib import contextmanager
from contextvars import ContextVar

from langchain_core.language_models.chat_models import BaseChatModel

logger = logging.getLogger(__name__)
_model_selection = ContextVar("agent_model_selection", default=None)
_temperature_override = ContextVar("agent_temperature_override", default=None)
MIN_TEMPERATURE = 0.0
MAX_TEMPERATURE = 1.0


@contextmanager
def selected_model(agent_type, selection):
    token = _model_selection.set((agent_type, selection) if selection else None)
    try:
        yield
    finally:
        _model_selection.reset(token)


@contextmanager
def temperature_override(agent_type, value):
    token = _temperature_override.set((agent_type, value) if value is not None else None)
    try:
        yield
    finally:
        _temperature_override.reset(token)


class LLMProvider(str, Enum):
    """Supported LLM providers."""
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    OLLAMA = "ollama"


@dataclass
class LLMConfig:
    """Configuration for LLM initialization."""
    provider: LLMProvider
    model: str
    temperature: float = 0.7
    max_tokens: Optional[int] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None  # For Ollama or custom endpoints
    max_retries: Optional[int] = None

    @classmethod
    def from_env(cls, agent_type: str = "default") -> "LLMConfig":
        """Create config from environment variables.

        Environment variables:
            LLM_PROVIDER: openai, anthropic, or ollama
            LLM_MODEL: Model name (e.g., gpt-4, claude-3-opus, llama2)
            LLM_TEMPERATURE: Temperature for generation
            LLM_MAX_TOKENS: Max tokens for response
            OPENAI_API_KEY: OpenAI API key
            ANTHROPIC_API_KEY: Anthropic API key
            OLLAMA_BASE_URL: Ollama server URL (default: http://localhost:11434)

            Agent-specific overrides:
            QAE_MODEL, QAE_TEMPERATURE, etc.
            AUE_MODEL, AUE_TEMPERATURE, etc.
        """
        prefix = agent_type.upper() if agent_type != "default" else ""

        # Get provider
        provider_str = os.getenv(
            f"{prefix}_PROVIDER" if prefix else "LLM_PROVIDER",
            os.getenv("LLM_PROVIDER", "openai")
        )
        provider = LLMProvider(provider_str.lower())
        selected = _model_selection.get()
        override = selected[1] if selected and selected[0] == agent_type else None
        if override:
            provider = LLMProvider(override["provider"])

        # Get model with fallbacks
        default_models = {
            LLMProvider.OPENAI: "gpt-4",
            LLMProvider.ANTHROPIC: "claude-3-sonnet-20240229",
            LLMProvider.OLLAMA: "llama3.1",
        }
        model = os.getenv(
            f"{prefix}_MODEL" if prefix else "LLM_MODEL",
            os.getenv("LLM_MODEL", default_models[provider])
        )
        if override:
            model = override["model"]

        # Get temperature
        temperature = float(os.getenv(
            f"{prefix}_TEMPERATURE" if prefix else "LLM_TEMPERATURE",
            os.getenv("LLM_TEMPERATURE", "0.7")
        ))
        temp_override = _temperature_override.get()
        if temp_override and temp_override[0] == agent_type and MIN_TEMPERATURE <= temp_override[1] <= MAX_TEMPERATURE:
            temperature = temp_override[1]

        # Get max tokens
        max_tokens_str = os.getenv(
            f"{prefix}_MAX_TOKENS" if prefix else "LLM_MAX_TOKENS",
            os.getenv("LLM_MAX_TOKENS", "")
        )
        max_tokens = int(max_tokens_str) if max_tokens_str else None

        # Get API keys
        api_key = None
        if provider == LLMProvider.OPENAI:
            api_key = os.getenv("OPENAI_API_KEY")
        elif provider == LLMProvider.ANTHROPIC:
            api_key = os.getenv("ANTHROPIC_API_KEY")

        # Get base URL for Ollama
        base_url = None
        if provider == LLMProvider.OLLAMA:
            base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        elif provider == LLMProvider.OPENAI:
            base_url = os.getenv("OPENAI_BASE_URL")
        elif provider == LLMProvider.ANTHROPIC:
            base_url = os.getenv("ANTHROPIC_BASE_URL")

        return cls(
            provider=provider,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            api_key=api_key,
            base_url=base_url,
        )


def create_llm(config: Optional[LLMConfig] = None, agent_type: str = "default") -> BaseChatModel:
    """Create an LLM instance based on configuration.

    Args:
        config: LLM configuration. If None, loads from environment.
        agent_type: Agent type for agent-specific config (qae, aue, superqa)

    Returns:
        Configured LangChain chat model

    Example:
        # Use environment variables
        llm = create_llm(agent_type="qae")

        # Use explicit config
        config = LLMConfig(
            provider=LLMProvider.OLLAMA,
            model="llama3.1",
            temperature=0.7,
        )
        llm = create_llm(config)
    """
    if config is None:
        config = LLMConfig.from_env(agent_type)

    logger.info(f"Creating LLM: provider={config.provider.value}, model={config.model}")

    if config.provider == LLMProvider.OPENAI:
        return _create_openai_llm(config)
    elif config.provider == LLMProvider.ANTHROPIC:
        return _create_anthropic_llm(config)
    elif config.provider == LLMProvider.OLLAMA:
        return _create_ollama_llm(config)
    else:
        raise ValueError(f"Unsupported LLM provider: {config.provider}")


def _create_openai_llm(config: LLMConfig) -> BaseChatModel:
    """Create OpenAI chat model."""
    try:
        from langchain_openai import ChatOpenAI
    except ImportError:
        raise ImportError("Please install langchain-openai: pip install langchain-openai")

    kwargs = {
        "model": config.model,
        "temperature": config.temperature,
    }

    if config.model.startswith(("o1", "o3", "o4", "gpt-5", "gpt-6")):
        kwargs["temperature"] = None
        kwargs["reasoning_effort"] = "none"

    if config.api_key:
        kwargs["api_key"] = config.api_key

    if config.max_tokens:
        kwargs["max_tokens"] = config.max_tokens

    if config.base_url:
        kwargs["base_url"] = config.base_url

    if config.max_retries is not None:
        kwargs["max_retries"] = config.max_retries
    return ChatOpenAI(**kwargs)


def _create_anthropic_llm(config: LLMConfig) -> BaseChatModel:
    """Create Anthropic Claude chat model."""
    try:
        from langchain_anthropic import ChatAnthropic
    except ImportError:
        raise ImportError("Please install langchain-anthropic: pip install langchain-anthropic")

    kwargs = {
        "model": config.model,
        "temperature": config.temperature,
    }

    if config.api_key:
        kwargs["api_key"] = config.api_key

    if config.max_tokens:
        kwargs["max_tokens"] = config.max_tokens

    if config.max_retries is not None:
        kwargs["max_retries"] = config.max_retries
    if config.base_url:
        kwargs["base_url"] = config.base_url
    return ChatAnthropic(**kwargs)


def _create_ollama_llm(config: LLMConfig) -> BaseChatModel:
    """Create Ollama chat model for local LLMs."""
    try:
        from langchain_ollama import ChatOllama
    except ImportError:
        raise ImportError("Please install langchain-ollama: pip install langchain-ollama")

    kwargs = {
        "model": config.model,
        "temperature": config.temperature,
    }

    if config.base_url:
        kwargs["base_url"] = config.base_url

    # Ollama doesn't use max_tokens the same way
    if config.max_tokens:
        kwargs["num_predict"] = config.max_tokens

    return ChatOllama(**kwargs)


def get_available_providers() -> List[dict]:
    """Get list of available LLM providers with their status."""
    providers = []

    # Check OpenAI
    openai_available = bool(os.getenv("OPENAI_API_KEY"))
    providers.append({
        "id": "openai",
        "name": "OpenAI",
        "available": openai_available,
        "models": ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"],
        "reason": None if openai_available else "OPENAI_API_KEY not set",
    })

    # Check Anthropic
    anthropic_available = bool(os.getenv("ANTHROPIC_API_KEY"))
    providers.append({
        "id": "anthropic",
        "name": "Anthropic",
        "available": anthropic_available,
        "models": ["claude-3-opus-20240229", "claude-3-sonnet-20240229", "claude-3-haiku-20240307"],
        "reason": None if anthropic_available else "ANTHROPIC_API_KEY not set",
    })

    # Check Ollama (try to connect)
    ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    ollama_available = _check_ollama_available(ollama_url)
    providers.append({
        "id": "ollama",
        "name": "Ollama (Local)",
        "available": ollama_available,
        "models": _get_ollama_models(ollama_url) if ollama_available else [],
        "reason": None if ollama_available else f"Ollama not running at {ollama_url}",
    })

    return providers


def _check_ollama_available(base_url: str) -> bool:
    """Check if Ollama server is available."""
    import httpx
    try:
        response = httpx.get(f"{base_url}/api/tags", timeout=2.0)
        return response.status_code == 200
    except Exception:
        return False


def _get_ollama_models(base_url: str) -> List[str]:
    """Get list of available Ollama models."""
    import httpx
    try:
        response = httpx.get(f"{base_url}/api/tags", timeout=5.0)
        if response.status_code == 200:
            data = response.json()
            return [model["name"] for model in data.get("models", [])]
    except Exception:
        pass
    return []


# Convenience functions for common use cases

def create_openai_llm(model: str = "gpt-4", temperature: float = 0.7) -> BaseChatModel:
    """Create an OpenAI LLM with simple parameters."""
    return create_llm(LLMConfig(
        provider=LLMProvider.OPENAI,
        model=model,
        temperature=temperature,
    ))


def create_anthropic_llm(model: str = "claude-3-sonnet-20240229", temperature: float = 0.7) -> BaseChatModel:
    """Create an Anthropic Claude LLM with simple parameters."""
    return create_llm(LLMConfig(
        provider=LLMProvider.ANTHROPIC,
        model=model,
        temperature=temperature,
    ))


def create_ollama_llm(model: str = "llama3.1", temperature: float = 0.7, base_url: str = None) -> BaseChatModel:
    """Create an Ollama LLM with simple parameters."""
    return create_llm(LLMConfig(
        provider=LLMProvider.OLLAMA,
        model=model,
        temperature=temperature,
        base_url=base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
    ))
