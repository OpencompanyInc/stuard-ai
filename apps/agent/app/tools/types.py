from __future__ import annotations

import functools
import inspect
from typing import Any, Callable, Dict, Type, Awaitable, Optional
from pydantic import BaseModel

class ToolInput(BaseModel):
    """Base class for tool input arguments."""
    pass

class ToolOutput(BaseModel):
    """Base class for tool output results."""
    ok: bool = True
    error: Optional[str] = None

class Tool:
    """
    Wraps a tool handler function with its input and output schemas.
    """
    def __init__(
        self,
        name: str,
        handler: Callable[[Any], Awaitable[Dict[str, Any]]],
        input_model: Type[BaseModel],
        output_model: Type[BaseModel],
        description: str = ""
    ):
        self.name = name
        self.handler = handler
        self.input_model = input_model
        self.output_model = output_model
        self.description = description
        # Check if handler accepts emit parameter
        try:
            sig = inspect.signature(handler)
            self._accepts_emit = len(sig.parameters) >= 2
        except Exception:
            self._accepts_emit = False

    async def __call__(self, args: Dict[str, Any], emit: Optional[Callable] = None) -> Dict[str, Any]:
        # Validate input
        try:
            input_data = self.input_model(**args)
        except Exception as e:
            return {"ok": False, "error": f"invalid_input: {str(e)}"}

        # Execute handler - only pass emit if the handler accepts it
        try:
            if emit and self._accepts_emit:
                result = await self.handler(input_data, emit)  # type: ignore
            else:
                result = await self.handler(input_data)  # type: ignore
        except Exception as e:
            return {"ok": False, "error": f"execution_error: {str(e)}"}

        # Validate output
        # The handler might return a dict or a model. We should support both.
        if isinstance(result, BaseModel):
            return result.model_dump()
        
        # If it's a dict, we try to validate it against the output model
        try:
            output_data = self.output_model(**result)
            return output_data.model_dump()
        except Exception as e:
             # If output validation fails, we still return the result but log/warn?
             # Or strict mode: return error. Let's be strict for "typed" tools.
             return {"ok": False, "error": f"invalid_output: {str(e)}", "raw_result": result}

def tool(
    name: str,
    input_model: Type[BaseModel],
    output_model: Type[BaseModel],
    description: str = ""
):
    """
    Decorator to register a function as a typed tool.
    The decorated function should accept an instance of input_model and return a dict or output_model.
    """
    def decorator(func: Callable[..., Awaitable[Any]]):
        t = Tool(
            name=name,
            handler=func,
            input_model=input_model,
            output_model=output_model,
            description=description or func.__doc__ or ""
        )
        # Preserve original function metadata
        functools.update_wrapper(t, func)
        return t
    return decorator
