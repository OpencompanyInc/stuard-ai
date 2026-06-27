from typing import Any, Dict
import logging

logger = logging.getLogger("agent")

# Global in-memory store for active workflow contexts
# Key: execution_id (or workflow_id for simple cases), Value: Dict
_CONTEXT_STORE: Dict[str, Dict[str, Any]] = {}

async def context_manager(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Manages state/context for workflow executions.
    
    This tool allows steps in a workflow to share data without direct wiring.
    It acts as a shared memory bus for the duration of a workflow execution.
    
    Args:
        action (str): create | get | set | merge | delete | clear
        contextId (str): Unique ID for the execution/session (default: "global")
        key (str): Key to get/set/delete (optional for get/merge)
        value (Any): Data to store (for set/merge)
        data (Dict): Initial data (for create)
    """
    action = str(args.get("action") or "get").lower()
    # Default to 'global' context if no execution_id provided (useful for simple testing)
    ctx_id = str(args.get("contextId") or "global")
    
    if ctx_id not in _CONTEXT_STORE:
        _CONTEXT_STORE[ctx_id] = {}
    
    ctx = _CONTEXT_STORE[ctx_id]
    
    if action == "create":
        # Initialize with provided data or empty
        init_data = args.get("data")
        if init_data and isinstance(init_data, dict):
             _CONTEXT_STORE[ctx_id] = init_data.copy()
        else:
             _CONTEXT_STORE[ctx_id] = {}
        return {"ok": True, "contextId": ctx_id, "count": len(_CONTEXT_STORE[ctx_id])}
        
    elif action == "get":
        key = args.get("key")
        if key:
            # Simple key retrieval
            val = ctx.get(str(key))
            return {"ok": True, "value": val}
        else:
            # Return full context
            return {"ok": True, "context": ctx}
            
    elif action == "set":
        key = args.get("key")
        val = args.get("value")
        if not key:
            return {"ok": False, "error": "missing_key"}
        ctx[str(key)] = val
        return {"ok": True}
        
    elif action == "merge":
        val = args.get("value")
        if not isinstance(val, dict):
            return {"ok": False, "error": "value_must_be_dict"}
        ctx.update(val)
        return {"ok": True}
        
    elif action == "delete":
        key = args.get("key")
        if key and str(key) in ctx:
            del ctx[str(key)]
        return {"ok": True}
        
    elif action == "clear":
        _CONTEXT_STORE[ctx_id] = {}
        return {"ok": True}
        
    return {"ok": False, "error": "unknown_action"}


