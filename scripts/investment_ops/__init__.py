"""Deterministic, read-only foundations for the investment operations package.

This package deliberately contains no broker order capability.
"""

from .config import ConfigError, RuntimeConfig, load_config

__all__ = ["ConfigError", "RuntimeConfig", "load_config"]
