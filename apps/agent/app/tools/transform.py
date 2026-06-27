from typing import Any, Dict
import logging

logger = logging.getLogger("agent")

async def transform_data(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Transforms input data using extraction or mapping rules.
    Serves as a "middleware" step to clean/reformat data between tools.
    
    Args:
        data: The input JSON/Dict/List.
        mode: "extract" | "map" | "template"
        rules: 
            - extract: "users.0.name" (dot notation)
            - map: {"userName": "users.0.name", "id": "users.0.id"}
    """
    data = args.get("data")
    mode = args.get("mode") or "extract"
    rules = args.get("rules")
    
    def get_by_path(obj, path):
        if not path:
            return obj
        parts = str(path).split(".")
        curr = obj
        for p in parts:
            if isinstance(curr, dict):
                curr = curr.get(p)
            elif isinstance(curr, list) and p.isdigit():
                try:
                    curr = curr[int(p)]
                except IndexError:
                    return None
            else:
                return None
        return curr

    if mode == "extract":
        if not isinstance(rules, str):
             return {"ok": False, "error": "rules_must_be_string_for_extract"}
        result = get_by_path(data, rules)
        return {"ok": True, "result": result}
        
    elif mode == "map":
        if not isinstance(rules, dict):
            return {"ok": False, "error": "rules_must_be_dict_for_map"}
        result = {}
        for new_key, path in rules.items():
            result[new_key] = get_by_path(data, str(path))
        return {"ok": True, "result": result}
    
    elif mode == "template":
        # Simple string interpolation? maybe later.
        pass
        
    return {"ok": False, "error": "unknown_mode"}


