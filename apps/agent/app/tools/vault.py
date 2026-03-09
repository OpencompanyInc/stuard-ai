"""
Vault Tools — Secure credential management for Stuard AI agent.

All credentials are encrypted at rest using AES-256-GCM with OS keychain-backed keys.
"""

from __future__ import annotations

from typing import Any, Dict


async def vault_list(args: Dict[str, Any]) -> Dict[str, Any]:
    """List vault entries (secrets are masked)."""
    from ..storage.vault_db import get_vault
    vault = get_vault()
    return vault.list_entries(
        category=args.get("category"),
        search=args.get("search") or args.get("query"),
        favorites_only=bool(args.get("favorites_only", False)),
        tag=args.get("tag"),
        limit=int(args.get("limit", 100)),
        offset=int(args.get("offset", 0)),
    )


async def vault_get(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get a single vault entry with decrypted secrets."""
    from ..storage.vault_db import get_vault
    entry_id = args.get("id") or args.get("entry_id")
    if not entry_id:
        return {"ok": False, "error": "Missing 'id' parameter"}

    vault = get_vault()
    entry = vault.get(entry_id, include_secrets=True)
    if not entry:
        return {"ok": False, "error": "Entry not found"}

    return {"ok": True, "entry": entry}


async def vault_add(args: Dict[str, Any]) -> Dict[str, Any]:
    """Add a new credential to the vault."""
    from ..storage.vault_db import get_vault
    name = args.get("name")
    if not name:
        return {"ok": False, "error": "Missing 'name' parameter"}

    vault = get_vault()
    return vault.add(
        name=name,
        category=args.get("category", "other"),
        service=args.get("service"),
        url=args.get("url"),
        username=args.get("username"),
        password=args.get("password"),
        notes=args.get("notes"),
        metadata=args.get("metadata"),
        favorite=bool(args.get("favorite", False)),
        tags=args.get("tags"),
    )


async def vault_update(args: Dict[str, Any]) -> Dict[str, Any]:
    """Update an existing vault entry."""
    from ..storage.vault_db import get_vault
    entry_id = args.get("id") or args.get("entry_id")
    if not entry_id:
        return {"ok": False, "error": "Missing 'id' parameter"}

    # Extract updatable fields
    fields = {}
    for key in ("name", "category", "service", "url", "username", "password",
                "notes", "metadata", "favorite", "tags"):
        if key in args:
            fields[key] = args[key]

    if not fields:
        return {"ok": False, "error": "No fields to update"}

    vault = get_vault()
    return vault.update(entry_id, **fields)


async def vault_delete(args: Dict[str, Any]) -> Dict[str, Any]:
    """Delete a vault entry."""
    from ..storage.vault_db import get_vault
    entry_id = args.get("id") or args.get("entry_id")
    if not entry_id:
        return {"ok": False, "error": "Missing 'id' parameter"}

    vault = get_vault()
    return vault.delete(entry_id)


async def vault_get_credential(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get just the credential (username + password) for agent use.

    This is the tool the AI agent calls when it needs to use stored
    credentials for a task (e.g., logging into a website).
    """
    from ..storage.vault_db import get_vault
    entry_id = args.get("id") or args.get("entry_id")
    if not entry_id:
        return {"ok": False, "error": "Missing 'id' parameter"}

    vault = get_vault()
    cred = vault.get_credential(entry_id)
    if not cred:
        return {"ok": False, "error": "Entry not found"}

    return {"ok": True, "credential": cred}


async def vault_search(args: Dict[str, Any]) -> Dict[str, Any]:
    """Search vault entries by service name."""
    from ..storage.vault_db import get_vault
    service = args.get("service") or args.get("query") or args.get("name")
    if not service:
        return {"ok": False, "error": "Missing 'service' or 'query' parameter"}

    vault = get_vault()
    entries = vault.search_by_service(service)
    return {"ok": True, "entries": entries, "count": len(entries)}


async def vault_stats(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get vault statistics."""
    from ..storage.vault_db import get_vault
    vault = get_vault()
    return vault.get_stats()
