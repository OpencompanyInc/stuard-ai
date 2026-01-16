"""
Sub-Agent Management Tools

Handles local spawning and tracking of parallel sub-agents.
Sub-agents run asynchronously and report results back to parent conversations.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Callable
from dataclasses import dataclass, asdict
import threading
import traceback

# Type alias for tool return values
ToolResult = Dict[str, Any]

# Simple tool handler wrapper (for schema documentation)
@dataclass
class ToolHandler:
    fn: Callable[..., Any]
    input_schema: Dict[str, Any]
    output_schema: Dict[str, Any]


# ═══════════════════════════════════════════════════════════════════════════════
# SUB-AGENT RUNNER
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class SubAgentTask:
    """Represents a running sub-agent task."""
    id: str
    parent_id: Optional[str]
    objective: str
    status: str  # 'running', 'completed', 'failed', 'cancelled'
    model: str
    tools_allowed: Optional[List[str]]
    custom_system_prompt: Optional[str]
    logs: List[Dict[str, Any]]
    result: Optional[Dict[str, Any]]
    created_at: str
    updated_at: str
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# In-memory registry of running sub-agents
_running_subagents: Dict[str, SubAgentTask] = {}
_subagent_lock = threading.Lock()


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat()


def register_subagent(
    task_id: str,
    parent_id: Optional[str],
    objective: str,
    model: str = 'fast',
    tools_allowed: Optional[List[str]] = None,
    custom_system_prompt: Optional[str] = None
) -> SubAgentTask:
    """Register a new sub-agent in the local registry."""
    now = _now_iso()
    task = SubAgentTask(
        id=task_id,
        parent_id=parent_id,
        objective=objective,
        status='running',
        model=model,
        tools_allowed=tools_allowed,
        custom_system_prompt=custom_system_prompt,
        logs=[],
        result=None,
        created_at=now,
        updated_at=now
    )
    
    with _subagent_lock:
        _running_subagents[task_id] = task
    
    return task


def update_subagent_status(
    task_id: str,
    status: Optional[str] = None,
    log_entry: Optional[Dict[str, Any]] = None,
    result: Optional[Dict[str, Any]] = None
) -> Optional[SubAgentTask]:
    """Update a sub-agent's status, logs, or result."""
    with _subagent_lock:
        task = _running_subagents.get(task_id)
        if not task:
            return None
        
        task.updated_at = _now_iso()
        
        if status:
            task.status = status
        
        if log_entry:
            # Keep max 500 log entries (increased for better trace history)
            task.logs.append(log_entry)
            if len(task.logs) > 500:
                task.logs = task.logs[-500:]
        
        if result is not None:
            task.result = result
        
        return task


def get_subagent(task_id: str) -> Optional[SubAgentTask]:
    """Get a sub-agent by ID."""
    with _subagent_lock:
        task = _running_subagents.get(task_id)
        if task:
            return task
    
    return None


def list_subagents(
    parent_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 25
) -> List[SubAgentTask]:
    """List sub-agents, optionally filtered by parent or status."""
    results: List[SubAgentTask] = []
    
    # Get in-memory running agents
    with _subagent_lock:
        for task in _running_subagents.values():
            if parent_id and task.parent_id != parent_id:
                continue
            if status and task.status != status:
                continue
            results.append(task)
    
    # Sort by created_at descending and limit
    results.sort(key=lambda t: t.created_at, reverse=True)
    return results[:limit]


def cleanup_completed_subagents(max_age_hours: int = 24) -> int:
    """Remove completed sub-agents older than max_age_hours from memory."""
    from datetime import datetime, timedelta
    
    cutoff = datetime.now().astimezone() - timedelta(hours=max_age_hours)
    removed = 0
    
    with _subagent_lock:
        to_remove = []
        for task_id, task in _running_subagents.items():
            if task.status in ('completed', 'failed'):
                try:
                    task_time = datetime.fromisoformat(task.created_at)
                    if task_time < cutoff:
                        to_remove.append(task_id)
                except Exception:
                    pass
        
        for task_id in to_remove:
            del _running_subagents[task_id]
            removed += 1
    
    return removed


# ═══════════════════════════════════════════════════════════════════════════════
# TOOL HANDLERS
# ═══════════════════════════════════════════════════════════════════════════════

async def subagent_spawn(args: Dict[str, Any]) -> ToolResult:
    """
    Spawn a new sub-agent to run a task asynchronously.
    This is called by the cloud when deploy_headless_agent is used.
    """
    try:
        objective = args.get('objective', '')
        parent_id = args.get('parent_id')
        model = args.get('model', 'fast')
        tools_allowed = args.get('tools_allowed')
        custom_system_prompt = args.get('custom_system_prompt')
        
        if not objective:
            return {"ok": False, "error": "objective is required"}
        
        task_id = str(uuid.uuid4())
        
        task = register_subagent(
            task_id=task_id,
            parent_id=parent_id,
            objective=objective,
            model=model,
            tools_allowed=tools_allowed,
            custom_system_prompt=custom_system_prompt
        )
        
        return {
            "ok": True,
            "task_id": task_id,
            "status": "running",
            "message": f"Sub-agent spawned to: {objective[:100]}"
        }
        
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def subagent_status(args: Dict[str, Any]) -> ToolResult:
    """Get the status of a sub-agent task."""
    try:
        task_id = args.get('task_id', '')
        
        if not task_id:
            return {"ok": False, "error": "task_id is required"}
        
        task = get_subagent(task_id)
        if not task:
            return {"ok": False, "error": f"Sub-agent not found: {task_id}"}
        
        return {
            "ok": True,
            "task": task.to_dict()
        }
        
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def subagent_list(args: Dict[str, Any]) -> ToolResult:
    """List sub-agents."""
    try:
        parent_id = args.get('parent_id')
        status = args.get('status')
        limit = min(args.get('limit', 25), 100)
        
        tasks = list_subagents(parent_id=parent_id, status=status, limit=limit)
        
        return {
            "ok": True,
            "tasks": [t.to_dict() for t in tasks]
        }
        
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def subagent_update(args: Dict[str, Any]) -> ToolResult:
    """Update a sub-agent's status or add a log entry."""
    try:
        task_id = args.get('task_id', '')
        status = args.get('status')
        log_entry = args.get('log')
        result = args.get('result')

        if not task_id:
            return {"ok": False, "error": "task_id is required"}

        task = update_subagent_status(
            task_id=task_id,
            status=status,
            log_entry=log_entry,
            result=result
        )

        if not task:
            return {"ok": False, "error": f"Sub-agent not found: {task_id}"}

        return {
            "ok": True,
            "task": task.to_dict()
        }

    except Exception as e:
        return {"ok": False, "error": str(e)}


async def subagent_stop(args: Dict[str, Any]) -> ToolResult:
    """Stop a running sub-agent task."""
    try:
        task_id = args.get('task_id', '')

        if not task_id:
            return {"ok": False, "error": "task_id is required"}

        task = get_subagent(task_id)
        if not task:
            return {"ok": False, "error": f"Sub-agent not found: {task_id}"}

        if task.status != 'running':
            return {"ok": False, "error": f"Sub-agent is not running (status: {task.status})"}

        # Mark as cancelled
        task = update_subagent_status(
            task_id=task_id,
            status='cancelled',
            result={'stopped_by': 'user', 'reason': 'Manual stop requested'}
        )

        return {
            "ok": True,
            "task_id": task_id,
            "message": "Sub-agent stopped successfully"
        }

    except Exception as e:
        return {"ok": False, "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════════
# TOOL DEFINITIONS
# ═══════════════════════════════════════════════════════════════════════════════

SUBAGENT_TOOLS: Dict[str, ToolHandler] = {
    "subagent_spawn": ToolHandler(
        fn=subagent_spawn,
        input_schema={
            "type": "object",
            "properties": {
                "objective": {"type": "string", "description": "The goal for the sub-agent"},
                "parent_id": {"type": "string", "description": "Parent conversation ID"},
                "model": {"type": "string", "enum": ["fast", "balanced", "smart"], "default": "fast"},
                "tools_allowed": {"type": "array", "items": {"type": "string"}, "description": "Allowed tools"},
                "custom_system_prompt": {"type": "string", "description": "Custom instructions"}
            },
            "required": ["objective"]
        },
        output_schema={
            "type": "object",
            "properties": {
                "ok": {"type": "boolean"},
                "task_id": {"type": "string"},
                "status": {"type": "string"},
                "message": {"type": "string"},
                "error": {"type": "string"}
            }
        }
    ),
    "subagent_status": ToolHandler(
        fn=subagent_status,
        input_schema={
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "The sub-agent task ID"}
            },
            "required": ["task_id"]
        },
        output_schema={
            "type": "object",
            "properties": {
                "ok": {"type": "boolean"},
                "task": {"type": "object"},
                "error": {"type": "string"}
            }
        }
    ),
    "subagent_list": ToolHandler(
        fn=subagent_list,
        input_schema={
            "type": "object",
            "properties": {
                "parent_id": {"type": "string", "description": "Filter by parent conversation"},
                "status": {"type": "string", "enum": ["running", "completed", "failed"]},
                "limit": {"type": "integer", "default": 25, "maximum": 100}
            }
        },
        output_schema={
            "type": "object",
            "properties": {
                "ok": {"type": "boolean"},
                "tasks": {"type": "array"},
                "error": {"type": "string"}
            }
        }
    ),
    "subagent_update": ToolHandler(
        fn=subagent_update,
        input_schema={
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "The sub-agent task ID"},
                "status": {"type": "string", "enum": ["running", "completed", "failed"]},
                "log": {"type": "object", "description": "Log entry to append"},
                "result": {"type": "object", "description": "Final result when completed"}
            },
            "required": ["task_id"]
        },
        output_schema={
            "type": "object",
            "properties": {
                "ok": {"type": "boolean"},
                "task": {"type": "object"},
                "error": {"type": "string"}
            }
        }
    ),
    "subagent_stop": ToolHandler(
        fn=subagent_stop,
        input_schema={
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "The sub-agent task ID to stop"}
            },
            "required": ["task_id"]
        },
        output_schema={
            "type": "object",
            "properties": {
                "ok": {"type": "boolean"},
                "task_id": {"type": "string"},
                "message": {"type": "string"},
                "error": {"type": "string"}
            }
        }
    ),
}
