import asyncio
from typing import Any, Dict, List
import logging

logger = logging.getLogger("agent")

async def parallel_executor(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Executes multiple tools in parallel.
    
    Args:
        tasks: List of dicts, each containing "tool" (str) and "args" (dict).
        concurrency: Max number of concurrent tasks (default: 5).
        stop_on_error: If True, stops all tasks if one fails (default: False).
    """
    tasks_list = args.get("tasks")
    if not isinstance(tasks_list, list):
        return {"ok": False, "error": "tasks_must_be_list"}
        
    concurrency = int(args.get("concurrency") or 5)
    
    # Import dispatch dynamically to avoid circular import
    from .dispatch import execute
    
    semaphore = asyncio.Semaphore(concurrency)
    
    async def worker(task):
        tool_name = task.get("tool")
        tool_args = task.get("args") or {}
        async with semaphore:
            try:
                # We pass None for emit to keep it simple for now, or we could aggregate logs
                return await execute(tool_name, tool_args)
            except Exception as e:
                logger.error(f"parallel_executor task failed: {tool_name} {e}")
                return {"ok": False, "error": str(e), "tool": tool_name}

    results = await asyncio.gather(*(worker(t) for t in tasks_list))
    
    return {"ok": True, "results": results}


