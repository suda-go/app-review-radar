"""Thin MCP stdio server that proxies all calls to the remote KG API.

Usage:
    python -m kg_mcp_client --api-url http://kg-api.internal:8000

No local KG data, no embeddings, no heavy dependencies.
Only needs: fastmcp, httpx.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

import httpx
from fastmcp import FastMCP

logger = logging.getLogger("kg_mcp_client")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
API_BASE = os.environ.get("KG_API_URL", "http://kg.ad.intl.xiaomi.com")
_client: httpx.Client | None = None

mcp = FastMCP("Knowledge Graph MCP Client")


def _get_client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(base_url=API_BASE, timeout=30.0)
    return _client


def _call_api(endpoint: str, payload: dict) -> dict:
    """POST to the remote KG API and return the JSON response."""
    resp = _get_client().post(endpoint, json=payload)
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# MCP Tools — thin proxies
# ---------------------------------------------------------------------------

@mcp.tool
def kg_resolve_concept(query: str, business: str, domain: str | None = None) -> dict:
    """Map a natural language query to a KG node.

    Args:
        query: Natural language query (e.g. "7 day retention")
        business: Business context (e.g. "video", "activity")
        domain: Optional domain filter
    """
    return _call_api("/resolve_concept", {
        "query": query, "business": business, "domain": domain,
    })


@mcp.tool
def kg_get_definition(concept_id: str, business: str | None = None) -> dict:
    """Get the meaning of a concept by its namespaced ID.

    Args:
        concept_id: Namespaced ID (e.g. "video.metric.video_dau")
        business: Optional business context for cross-business validation
    """
    return _call_api("/get_definition", {
        "concept_id": concept_id, "business": business,
    })


@mcp.tool
def kg_get_dependencies(concept_id: str, business: str | None = None) -> dict:
    """Get structural dependencies of a concept.

    Args:
        concept_id: Namespaced ID (e.g. "video.metric.video_dau")
        business: Optional business context for cross-business validation
    """
    return _call_api("/get_dependencies", {
        "concept_id": concept_id, "business": business,
    })


@mcp.tool
def kg_get_table_schema(table_id: str, business: str | None = None) -> dict:
    """Get the schema of a table node.

    Args:
        table_id: Namespaced table ID (e.g. "video.table.video_events")
        business: Optional business context for cross-business validation
    """
    return _call_api("/get_table_schema", {
        "table_id": table_id, "business": business,
    })


@mcp.tool
def kg_search_knowledge(query: str, business: str) -> dict:
    """Broad exploration search across the knowledge graph.

    Args:
        query: Natural language search query
        business: Business context (required)
    """
    return _call_api("/search_knowledge", {
        "query": query, "business": business,
    })


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="KG MCP Client (thin proxy)")
    parser.add_argument(
        "--api-url",
        default=os.environ.get("KG_API_URL", "http://kg.ad.intl.xiaomi.com"),
        help="KG API service URL (default: $KG_API_URL or http://kg.ad.intl.xiaomi.com)",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Log level (default: INFO)",
    )
    args = parser.parse_args()

    global API_BASE
    API_BASE = args.api_url

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
        stream=sys.stderr,
    )

    logger.info("Proxying MCP calls to %s", API_BASE)
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
