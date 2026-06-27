from __future__ import annotations

import asyncio
import argparse
import json
import traceback
from typing import Any, Dict, List, Optional, Type
from pydantic import BaseModel

from .dispatch import _HANDLERS
from .types import Tool

class ToolTestCase(BaseModel):
    name: str
    input: Dict[str, Any]
    expected_output: Optional[Dict[str, Any]] = None
    expected_error: Optional[str] = None
    # If expected_output is None and expected_error is None, we just check for ok=True

async def run_tool_test(tool_or_name: str | Tool, test_case: ToolTestCase) -> bool:
    if isinstance(tool_or_name, Tool):
        tool_name = tool_or_name.name
        print(f"Running test '{test_case.name}' for tool '{tool_name}'...")
        handler = tool_or_name
    else:
        tool_name = str(tool_or_name)
        print(f"Running test '{test_case.name}' for tool '{tool_name}'...")
        handler = _HANDLERS.get(tool_name)
        if not handler:
            print(f"  [FAIL] Tool '{tool_name}' not found.")
            return False
    
    if not isinstance(handler, Tool):
        print(f"  [SKIP] Tool '{tool_name}' is not a typed Tool (legacy).")
        return False

    try:
        # Run the tool
        # We pass the raw dict input, the Tool wrapper handles validation
        result = await handler(test_case.input)
        
        # Check success/failure
        if test_case.expected_error:
            if result.get("ok"):
                print(f"  [FAIL] Expected error '{test_case.expected_error}', but got success.")
                print(f"  Result: {json.dumps(result, default=str)}")
                return False
            if test_case.expected_error not in str(result.get("error") or ""):
                print(f"  [FAIL] Expected error containing '{test_case.expected_error}', got '{result.get('error')}'.")
                return False
            print("  [PASS] Got expected error.")
            return True
        
        if not result.get("ok"):
            print(f"  [FAIL] Tool execution failed: {result.get('error')}")
            return False
            
        # Check output
        if test_case.expected_output:
            # Simple subset check
            for k, v in test_case.expected_output.items():
                if result.get(k) != v:
                    print(f"  [FAIL] Output mismatch for key '{k}'. Expected '{v}', got '{result.get(k)}'.")
                    print(f"  Result: {json.dumps(result, default=str)}")
                    return False
            print("  [PASS] Output matches expectation.")
            return True
            
        print("  [PASS] Execution successful.")
        return True

    except Exception:
        print(f"  [FAIL] Exception during test execution:")
        traceback.print_exc()
        return False

async def main():
    parser = argparse.ArgumentParser(description="Run tool tests.")
    parser.add_argument("tool", help="Name of the tool to test")
    parser.add_argument("--file", help="JSON file containing test cases (list of ToolTestCase)")
    args = parser.parse_args()
    
    if args.file:
        try:
            with open(args.file, "r") as f:
                data = json.load(f)
                test_cases = [ToolTestCase(**item) for item in data]
        except Exception as e:
            print(f"Error loading test file: {e}")
            return
    else:
        print("No test file provided. Use --file <path_to_json>")
        return

    passed = 0
    total = len(test_cases)
    
    for tc in test_cases:
        if await run_tool_test(args.tool, tc):
            passed += 1
            
    print(f"\nTest Summary: {passed}/{total} passed.")
    if passed < total:
        exit(1)

if __name__ == "__main__":
    asyncio.run(main())
