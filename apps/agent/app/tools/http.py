"""HTTP request tool - curl/Postman-like functionality."""

from __future__ import annotations

import asyncio
import os
import json
import base64
import time
from typing import Any, Dict, Optional, List
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

try:
    import aiohttp
    HAS_AIOHTTP = True
except ImportError:
    HAS_AIOHTTP = False


async def http_request(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Make HTTP requests like curl or Postman.
    
    Args:
        url: The URL to request
        method: HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
        headers: Optional dict of headers
        query: Optional dict of query parameters
        body: Optional request body (string or dict for JSON)
        form: Optional form data (dict, will be sent as application/x-www-form-urlencoded)
        json_body: Optional JSON body (dict, will be serialized and sent with Content-Type: application/json)
        auth: Optional auth config: { "type": "basic"|"bearer", "username"?, "password"?, "token"? }
        timeout: Request timeout in seconds (default 30)
        follow_redirects: Whether to follow redirects (default True)
        verify_ssl: Whether to verify SSL certificates (default True)
        raw_response: If True, return raw bytes as base64 instead of trying to decode as text
    
    Returns:
        Dict with status, headers, body, elapsed_ms, etc.
    """
    if not HAS_AIOHTTP:
        return {"ok": False, "error": "aiohttp not installed. Run: pip install aiohttp"}
    
    url = args.get("url", "")
    if not url:
        return {"ok": False, "error": "url is required"}
    
    # Validate URL
    parsed = urlparse(url)
    if not parsed.scheme:
        url = "https://" + url
    elif parsed.scheme not in ("http", "https"):
        return {"ok": False, "error": f"Invalid URL scheme: {parsed.scheme}"}
    
    method = str(args.get("method", "GET")).upper()
    if method not in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"):
        return {"ok": False, "error": f"Invalid method: {method}"}
    
    headers = args.get("headers") or {}
    query = args.get("query") or {}
    params = args.get("params") or {}
    body = args.get("body")
    form = args.get("form")
    json_body = args.get("json_body")
    multipart = args.get("multipart")
    files = args.get("files")
    cookies = args.get("cookies")
    auth = args.get("auth")
    bearer_token = args.get("bearer_token")
    timeout_ms = args.get("timeoutMs")
    timeout = args.get("timeout", 30)
    follow_redirects = args.get("follow_redirects", True)
    verify_ssl = args.get("verify_ssl", True)
    raw_response = args.get("raw_response", False)
    max_response_bytes = args.get("max_response_bytes")
    save_to = args.get("save_to")
    retries = args.get("retries", 0)
    retry_delay_ms = args.get("retry_delay_ms", 500)
    retry_on_status = args.get("retry_on_status")
    
    if isinstance(timeout_ms, (int, float)) and float(timeout_ms) > 0:
        timeout = float(timeout_ms) / 1000.0
    try:
        timeout = float(timeout)
    except Exception:
        timeout = 30.0
    if timeout <= 0:
        timeout = 30.0

    try:
        max_bytes = int(max_response_bytes) if max_response_bytes is not None else 5 * 1024 * 1024
    except Exception:
        max_bytes = 5 * 1024 * 1024
    max_bytes = max(0, min(max_bytes, 50 * 1024 * 1024))

    try:
        retries = int(retries)
    except Exception:
        retries = 0
    retries = max(0, min(retries, 10))

    try:
        retry_delay_ms = int(retry_delay_ms)
    except Exception:
        retry_delay_ms = 500
    retry_delay_ms = max(0, min(retry_delay_ms, 60000))

    if not isinstance(retry_on_status, list) or not retry_on_status:
        retry_on_status = [408, 425, 429, 500, 502, 503, 504]
    else:
        try:
            retry_on_status = [int(x) for x in retry_on_status]
        except Exception:
            retry_on_status = [408, 425, 429, 500, 502, 503, 504]

    if not isinstance(headers, dict):
        return {"ok": False, "error": "headers must be an object"}
    headers = {str(k): str(v) for k, v in headers.items() if k is not None}

    if cookies is not None and not isinstance(cookies, dict):
        return {"ok": False, "error": "cookies must be an object"}
    cookies = {str(k): str(v) for k, v in cookies.items() if k is not None} if isinstance(cookies, dict) else None

    if not isinstance(query, dict):
        return {"ok": False, "error": "query must be an object"}
    if not isinstance(params, dict):
        return {"ok": False, "error": "params must be an object"}

    merged_query = {**{str(k): str(v) for k, v in query.items() if k is not None}, **{str(k): str(v) for k, v in params.items() if k is not None}}

    parsed_url = urlparse(url)
    existing_qs = parse_qsl(parsed_url.query, keep_blank_values=True)
    existing_map: Dict[str, str] = {str(k): str(v) for k, v in existing_qs}
    final_query = {**existing_map, **merged_query}
    rebuilt_url = parsed_url._replace(query=urlencode(final_query))
    url = urlunparse(rebuilt_url)
    
    # Handle auth
    if isinstance(bearer_token, str) and bearer_token.strip():
        headers["Authorization"] = f"Bearer {bearer_token.strip()}"
    elif isinstance(auth, str) and auth.strip():
        headers["Authorization"] = f"Bearer {auth.strip()}"
    elif isinstance(auth, dict):
        auth_type = str(auth.get("type", "")).lower()
        if auth_type == "basic":
            username = str(auth.get("username", ""))
            password = str(auth.get("password", ""))
            creds = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("utf-8")
            headers["Authorization"] = f"Basic {creds}"
        elif auth_type == "bearer":
            token = str(auth.get("token", ""))
            if token:
                headers["Authorization"] = f"Bearer {token}"
    
    def _build_request_body() -> tuple[Any, Any, List[Any]]:
        data_local: Any = None
        json_payload_local: Any = None
        handles: List[Any] = []

        if multipart is not None or files is not None:
            form_data = aiohttp.FormData()
            if isinstance(multipart, dict):
                for k, v in multipart.items():
                    if v is None:
                        continue
                    form_data.add_field(str(k), str(v))

            if isinstance(files, list):
                for f in files:
                    if not isinstance(f, dict):
                        continue
                    field = str(f.get("field") or f.get("name") or "file")
                    path = f.get("path")
                    if not isinstance(path, str) or not path:
                        continue
                    filename = f.get("filename")
                    content_type = f.get("contentType") or f.get("content_type")
                    fh = open(path, "rb")
                    handles.append(fh)
                    kwargs: Dict[str, Any] = {
                        "filename": str(filename) if filename else os.path.basename(path),
                    }
                    if content_type:
                        kwargs["content_type"] = str(content_type)
                    form_data.add_field(field, fh, **kwargs)

            data_local = form_data
        elif json_body is not None:
            headers.setdefault("Content-Type", "application/json")
            json_payload_local = json_body
        elif form is not None:
            if not isinstance(form, dict):
                raise ValueError("form must be an object")
            headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
            data_local = urlencode({str(k): str(v) for k, v in form.items() if k is not None})
        elif body is not None:
            data_local = body

        return data_local, json_payload_local, handles
    
    try:
        connector = aiohttp.TCPConnector(ssl=verify_ssl)
        client_timeout = aiohttp.ClientTimeout(total=timeout)

        async with aiohttp.ClientSession(connector=connector, timeout=client_timeout) as session:
            attempt = 0
            while True:
                attempt += 1
                started = time.monotonic()
                per_attempt_files: List[Any] = []
                try:
                    try:
                        data, json_payload, per_attempt_files = _build_request_body()
                    except Exception as e:
                        return {"ok": False, "error": f"Invalid request body: {str(e)}"}

                    async with session.request(
                        method,
                        url,
                        headers=headers,
                        data=data,
                        json=json_payload,
                        cookies=cookies if isinstance(cookies, dict) else None,
                        allow_redirects=follow_redirects,
                    ) as resp:
                        status = resp.status
                        resp_headers = dict(resp.headers)

                        if status in retry_on_status and attempt <= retries:
                            try:
                                await resp.release()
                            except Exception:
                                pass
                            await asyncio.sleep(retry_delay_ms / 1000.0)
                            continue

                        truncated = False
                        saved_to: Optional[str] = None
                        raw_bytes: bytes

                        if isinstance(save_to, str) and save_to:
                            os.makedirs(os.path.dirname(save_to) or ".", exist_ok=True)
                            total = 0
                            with open(save_to, "wb") as f:
                                async for chunk in resp.content.iter_chunked(65536):
                                    if not chunk:
                                        continue
                                    f.write(chunk)
                                    total += len(chunk)
                            saved_to = save_to
                            raw_bytes = b""
                            body_type = "text"
                            response_body: Any = ""
                            elapsed_ms = int((time.monotonic() - started) * 1000)
                            return {
                                "ok": True,
                                "status": status,
                                "status_text": resp.reason,
                                "headers": resp_headers,
                                "body": response_body,
                                "body_type": body_type,
                                "body_length": total,
                                "url": str(resp.url),
                                "elapsed_ms": elapsed_ms,
                                "truncated": False,
                                "saved_to": saved_to,
                            }

                        if max_bytes == 0:
                            raw_bytes = b""
                        else:
                            raw_bytes = await resp.content.read(max_bytes + 1)
                            if max_bytes > 0 and len(raw_bytes) > max_bytes:
                                raw_bytes = raw_bytes[:max_bytes]
                                truncated = True

                        if raw_response:
                            response_body = base64.b64encode(raw_bytes).decode("utf-8")
                            body_type = "base64"
                        else:
                            content_type = resp_headers.get("Content-Type", "")
                            try:
                                if "application/json" in content_type or "+json" in content_type:
                                    response_body = json.loads(raw_bytes.decode("utf-8"))
                                    body_type = "json"
                                else:
                                    response_body = raw_bytes.decode("utf-8", errors="replace")
                                    body_type = "text"
                            except Exception:
                                response_body = base64.b64encode(raw_bytes).decode("utf-8")
                                body_type = "base64"

                        elapsed_ms = int((time.monotonic() - started) * 1000)

                        return {
                            "ok": True,
                            "status": status,
                            "status_text": resp.reason,
                            "headers": resp_headers,
                            "body": response_body,
                            "body_type": body_type,
                            "body_length": len(raw_bytes),
                            "url": str(resp.url),
                            "elapsed_ms": elapsed_ms,
                            "truncated": truncated,
                            "saved_to": saved_to,
                        }

                except asyncio.TimeoutError:
                    if attempt <= retries:
                        await asyncio.sleep(retry_delay_ms / 1000.0)
                        continue
                    return {"ok": False, "error": f"Request timed out after {timeout}s"}
                except aiohttp.ClientError as e:
                    if attempt <= retries:
                        await asyncio.sleep(retry_delay_ms / 1000.0)
                        continue
                    return {"ok": False, "error": f"Request failed: {str(e)}"}
                finally:
                    for fh in per_attempt_files:
                        try:
                            fh.close()
                        except Exception:
                            pass

    except Exception as e:
        return {"ok": False, "error": f"Unexpected error: {str(e)}"}
    finally:
        pass
