"""
Utility tools for common operations that don't need scripts.
These are lightweight, fast tools for getting date/time, math, UUIDs, etc.
"""

from typing import Any, Dict, Callable, Awaitable
import datetime
import uuid
import random
import math
import re
import json
import os
import platform


async def get_datetime(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """Get current date and time with optional formatting."""
    try:
        fmt = args.get("format")
        tz_offset = args.get("tzOffset")  # offset in minutes from UTC
        
        now = datetime.datetime.now()
        utc_now = datetime.datetime.utcnow()
        
        # Apply timezone offset if provided
        if isinstance(tz_offset, (int, float)):
            now = utc_now + datetime.timedelta(minutes=tz_offset)
        
        result = {
            "ok": True,
            "iso": now.isoformat(),
            "unix": int(now.timestamp()),
            "unixMs": int(now.timestamp() * 1000),
            "year": now.year,
            "month": now.month,
            "day": now.day,
            "hour": now.hour,
            "minute": now.minute,
            "second": now.second,
            "weekday": now.strftime("%A"),
            "weekdayShort": now.strftime("%a"),
            "monthName": now.strftime("%B"),
            "monthShort": now.strftime("%b"),
            "date": now.strftime("%Y-%m-%d"),
            "time": now.strftime("%H:%M:%S"),
            "time12": now.strftime("%I:%M:%S %p"),
        }
        
        # Apply custom format if provided
        if fmt:
            try:
                result["formatted"] = now.strftime(fmt)
            except Exception as e:
                result["formatError"] = str(e)
        
        return result
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def math_eval(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """Evaluate a safe math expression."""
    try:
        expr = str(args.get("expression") or "")
        if not expr:
            return {"ok": False, "error": "missing_expression"}
        
        # Safe math functions and constants
        safe_dict = {
            "abs": abs,
            "round": round,
            "min": min,
            "max": max,
            "sum": sum,
            "pow": pow,
            "sqrt": math.sqrt,
            "sin": math.sin,
            "cos": math.cos,
            "tan": math.tan,
            "asin": math.asin,
            "acos": math.acos,
            "atan": math.atan,
            "atan2": math.atan2,
            "log": math.log,
            "log10": math.log10,
            "log2": math.log2,
            "exp": math.exp,
            "floor": math.floor,
            "ceil": math.ceil,
            "pi": math.pi,
            "e": math.e,
            "tau": math.tau,
            "inf": math.inf,
            "nan": math.nan,
            "radians": math.radians,
            "degrees": math.degrees,
            "factorial": math.factorial,
            "gcd": math.gcd,
            "lcm": getattr(math, 'lcm', lambda a, b: abs(a * b) // math.gcd(a, b)),
            "hypot": math.hypot,
            "isnan": math.isnan,
            "isinf": math.isinf,
            "isfinite": math.isfinite,
        }
        
        # Basic security: only allow safe characters
        if not re.match(r'^[\d\s\+\-\*\/\%\(\)\.\,\w]+$', expr):
            return {"ok": False, "error": "invalid_characters"}
        
        # Evaluate the expression
        result = eval(expr, {"__builtins__": {}}, safe_dict)
        
        return {
            "ok": True,
            "result": result,
            "expression": expr,
            "type": type(result).__name__,
        }
    except ZeroDivisionError:
        return {"ok": False, "error": "division_by_zero"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def generate_uuid(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """Generate a UUID."""
    try:
        version = args.get("version", 4)
        count = min(args.get("count", 1), 100)  # Cap at 100
        
        uuids = []
        for _ in range(count):
            if version == 1:
                u = uuid.uuid1()
            elif version == 4:
                u = uuid.uuid4()
            else:
                u = uuid.uuid4()
            uuids.append(str(u))
        
        return {
            "ok": True,
            "uuid": uuids[0] if count == 1 else None,
            "uuids": uuids if count > 1 else None,
            "count": count,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def random_number(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """Generate random numbers."""
    try:
        min_val = args.get("min", 0)
        max_val = args.get("max", 100)
        count = min(args.get("count", 1), 1000)  # Cap at 1000
        is_float = args.get("float", False)
        decimals = args.get("decimals", 2)
        
        numbers = []
        for _ in range(count):
            if is_float:
                n = random.uniform(min_val, max_val)
                n = round(n, decimals)
            else:
                n = random.randint(int(min_val), int(max_val))
            numbers.append(n)
        
        return {
            "ok": True,
            "value": numbers[0] if count == 1 else None,
            "values": numbers if count > 1 else None,
            "min": min_val,
            "max": max_val,
            "count": count,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def random_choice(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """Pick random item(s) from a list."""
    try:
        items = args.get("items", [])
        count = min(args.get("count", 1), len(items) if items else 1)
        allow_duplicates = args.get("allowDuplicates", False)
        
        if not items:
            return {"ok": False, "error": "empty_items"}
        
        if allow_duplicates:
            choices = [random.choice(items) for _ in range(count)]
        else:
            if count > len(items):
                count = len(items)
            choices = random.sample(items, count)
        
        return {
            "ok": True,
            "choice": choices[0] if count == 1 else None,
            "choices": choices if count > 1 else None,
            "count": count,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def get_env_var(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """Get environment variable value."""
    try:
        name = str(args.get("name") or "")
        default = args.get("default")
        
        if not name:
            return {"ok": False, "error": "missing_name"}
        
        value = os.environ.get(name, default)
        
        return {
            "ok": True,
            "name": name,
            "value": value,
            "exists": name in os.environ,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def get_system_info(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """Get basic system information."""
    try:
        return {
            "ok": True,
            "os": platform.system(),
            "osVersion": platform.version(),
            "osRelease": platform.release(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "python": platform.python_version(),
            "hostname": platform.node(),
            "username": os.environ.get("USERNAME") or os.environ.get("USER") or "unknown",
            "home": os.path.expanduser("~"),
            "cwd": os.getcwd(),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def hash_string(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """Hash a string using various algorithms."""
    try:
        import hashlib
        
        text = str(args.get("text") or "")
        algorithm = str(args.get("algorithm") or "sha256").lower()
        
        if algorithm not in ["md5", "sha1", "sha256", "sha512"]:
            return {"ok": False, "error": f"unsupported_algorithm: {algorithm}"}
        
        h = hashlib.new(algorithm)
        h.update(text.encode("utf-8"))
        
        return {
            "ok": True,
            "hash": h.hexdigest(),
            "algorithm": algorithm,
            "length": len(h.hexdigest()),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def base64_encode(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """Encode text to base64."""
    try:
        import base64 as b64
        
        text = str(args.get("text") or "")
        url_safe = args.get("urlSafe", False)
        
        data = text.encode("utf-8")
        if url_safe:
            encoded = b64.urlsafe_b64encode(data).decode("utf-8")
        else:
            encoded = b64.b64encode(data).decode("utf-8")
        
        return {
            "ok": True,
            "encoded": encoded,
            "urlSafe": url_safe,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def base64_decode(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """Decode base64 to text."""
    try:
        import base64 as b64
        
        encoded = str(args.get("encoded") or "")
        url_safe = args.get("urlSafe", False)
        
        if url_safe:
            decoded = b64.urlsafe_b64decode(encoded).decode("utf-8")
        else:
            decoded = b64.b64decode(encoded).decode("utf-8")
        
        return {
            "ok": True,
            "decoded": decoded,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def json_parse(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """Parse a JSON string."""
    try:
        text = str(args.get("text") or "")
        
        if not text:
            return {"ok": False, "error": "empty_input"}
        
        parsed = json.loads(text)
        
        return {
            "ok": True,
            "data": parsed,
            "type": type(parsed).__name__,
        }
    except json.JSONDecodeError as e:
        return {"ok": False, "error": f"invalid_json: {e}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def json_stringify(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """Convert data to JSON string."""
    try:
        data = args.get("data")
        pretty = args.get("pretty", False)
        
        if pretty:
            text = json.dumps(data, indent=2, ensure_ascii=False)
        else:
            text = json.dumps(data, ensure_ascii=False)
        
        return {
            "ok": True,
            "json": text,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def sleep(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """Sleep/wait for a specified duration."""
    try:
        import asyncio
        
        ms = args.get("ms", 0)
        seconds = args.get("seconds", 0)
        
        total_seconds = (ms / 1000) + seconds
        if total_seconds <= 0:
            return {"ok": False, "error": "invalid_duration"}
        
        # Cap at 5 minutes
        total_seconds = min(total_seconds, 300)
        
        await asyncio.sleep(total_seconds)
        
        return {
            "ok": True,
            "sleptMs": int(total_seconds * 1000),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def regex_match(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """Match a regex pattern against text."""
    try:
        text = str(args.get("text") or "")
        pattern = str(args.get("pattern") or "")
        flags_str = str(args.get("flags") or "")
        
        if not pattern:
            return {"ok": False, "error": "missing_pattern"}
        
        # Parse flags
        flags = 0
        if "i" in flags_str:
            flags |= re.IGNORECASE
        if "m" in flags_str:
            flags |= re.MULTILINE
        if "s" in flags_str:
            flags |= re.DOTALL
        
        compiled = re.compile(pattern, flags)
        
        # Find all matches
        matches = []
        for m in compiled.finditer(text):
            match_info = {
                "match": m.group(0),
                "start": m.start(),
                "end": m.end(),
                "groups": list(m.groups()) if m.groups() else None,
            }
            if m.groupdict():
                match_info["namedGroups"] = m.groupdict()
            matches.append(match_info)
        
        return {
            "ok": True,
            "matches": matches,
            "count": len(matches),
            "hasMatch": len(matches) > 0,
        }
    except re.error as e:
        return {"ok": False, "error": f"invalid_regex: {e}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def regex_replace(args: Dict[str, Any], emit: Callable[[str, Dict[str, Any] | None], Awaitable[None]] | None = None) -> Dict[str, Any]:
    """Replace text using a regex pattern."""
    try:
        text = str(args.get("text") or "")
        pattern = str(args.get("pattern") or "")
        replacement = str(args.get("replacement") or "")
        flags_str = str(args.get("flags") or "")
        count = args.get("count", 0)  # 0 = replace all
        
        if not pattern:
            return {"ok": False, "error": "missing_pattern"}
        
        # Parse flags
        flags = 0
        if "i" in flags_str:
            flags |= re.IGNORECASE
        if "m" in flags_str:
            flags |= re.MULTILINE
        if "s" in flags_str:
            flags |= re.DOTALL
        
        result = re.sub(pattern, replacement, text, count=count, flags=flags)
        
        return {
            "ok": True,
            "result": result,
            "changed": result != text,
        }
    except re.error as e:
        return {"ok": False, "error": f"invalid_regex: {e}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
