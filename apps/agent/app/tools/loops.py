from typing import Any, Dict, List
import logging

logger = logging.getLogger("agent")

async def loop_executor(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Executes a tool repeatedly based on loop logic.
    
    Args:
        mode: "each" | "while" | "until" | "times"
        
        # For 'each' mode:
        items: List of items to iterate over.
        item_var: Name of variable to pass item in (default "item").
        
        # For 'times' mode:
        count: Number of times to run.
        
        # For 'while'/'until' mode:
        condition: A Python expression string (e.g. "result.get('status') == 'pending'")
                   Available vars: 'result', 'i'
        max_iterations: Safety limit (default 100).
        
        # The Task to Run
        task: { "tool": "...", "args": {...} }
    """
    mode = args.get("mode") or "each"
    task = args.get("task")
    if not task or not isinstance(task, dict):
        return {"ok": False, "error": "missing_task_def"}
        
    # Dynamic import to avoid circular ref with dispatch
    from .dispatch import execute

    results = []
    
    if mode == "each":
        items = args.get("items") or []
        if not isinstance(items, list):
             return {"ok": False, "error": "items_must_be_list"}
        
        item_var = args.get("item_var") or "item"
        
        for i, item in enumerate(items):
            # Inject item into args
            # We do a shallow merge of the item into the args
            current_args = task.get("args", {}).copy()
            # If the args has the item_var key, we overwrite it
            # More complex substitution ({{item}}) would happen in the layer above usually
            current_args[item_var] = item
            current_args["_index"] = i
            
            try:
                res = await execute(task.get("tool"), current_args)
                results.append(res)
            except Exception as e:
                 results.append({"ok": False, "error": str(e)})
                 
    elif mode == "times":
        count = int(args.get("count") or 1)
        for i in range(count):
            current_args = task.get("args", {}).copy()
            current_args["_index"] = i
            res = await execute(task.get("tool"), current_args)
            results.append(res)

    elif mode in ("while", "until"):
        max_iter = int(args.get("max_iterations") or 100)
        condition = args.get("condition")
        if not condition:
             return {"ok": False, "error": "missing_condition_for_loop"}

        for i in range(max_iter):
            current_args = task.get("args", {}).copy()
            current_args["_index"] = i
            
            # Execute Step
            res = await execute(task.get("tool"), current_args)
            results.append(res)
            
            # Check Condition
            # We expose 'result' and 'i' to the condition scope
            eval_scope = {"result": res, "i": i}
            try:
                # RESTRICTED EVAL: No builtins access for safety
                # Users can only access dict/list methods on 'result'
                is_met = bool(eval(condition, {"__builtins__": {}}, eval_scope))
            except Exception as e:
                return {"ok": False, "error": f"condition_error: {e}", "results": results}
            
            if mode == "while" and not is_met:
                break
            if mode == "until" and is_met:
                break
                
    return {"ok": True, "results": results}


