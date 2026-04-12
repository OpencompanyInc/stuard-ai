from __future__ import annotations

import base64
import fnmatch
import glob
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
import xml.etree.ElementTree as ET
import zipfile
import zlib
from typing import Any, Dict, Optional

from .folder_limiter import FolderLimiter, current_session_id

WORKFLOW_TOOL_CALL_FLAG = "__workflowToolCall"


def _should_bypass_folder_permissions(args: Optional[Dict[str, Any]] = None) -> bool:
    if not isinstance(args, dict):
        return False
    return bool(args.get(WORKFLOW_TOOL_CALL_FLAG))


def _resolve_session(args: Optional[Dict[str, Any]] = None) -> str:
    """Get the session ID from args or the context var."""
    if isinstance(args, dict):
        sid = args.get("session_id") or args.get("sessionId")
        if sid:
            return str(sid)
    return current_session_id.get("default")


def _check_folder_read(path: str, args: Optional[Dict[str, Any]] = None) -> None:
    """Raise ValueError if the folder limiter denies read access to *path*."""
    if _should_bypass_folder_permissions(args):
        return
    limiter = FolderLimiter.get(_resolve_session(args))
    if not limiter.check_read(path):
        raise ValueError(limiter.describe_denial(path, "read"))


def _check_folder_write(path: str, args: Optional[Dict[str, Any]] = None) -> None:
    """Raise ValueError if the folder limiter denies write access to *path*."""
    if _should_bypass_folder_permissions(args):
        return
    limiter = FolderLimiter.get(_resolve_session(args))
    if not limiter.check_write(path):
        raise ValueError(limiter.describe_denial(path, "write"))


def _is_safe_path(path: str) -> bool:
    """
    Check if a path is safe to access (not a system directory).
    """
    p = os.path.abspath(os.path.expanduser(path))
    
    # Block common system directories
    unsafe_prefixes = []
    if sys.platform.startswith("win"):
        unsafe_prefixes = [
            os.path.expandvars("%WINDIR%"), 
            os.path.expandvars("%PROGRAMFILES%"),
            os.path.expandvars("%PROGRAMFILES(X86)%")
        ]
    else:
        unsafe_prefixes = ["/etc", "/var", "/usr", "/boot", "/proc", "/sys", "/dev"]
        
    for prefix in unsafe_prefixes:
        if prefix and p.startswith(prefix):
            return False
            
    return True

MAX_READ_FILE_BINARY_BYTES = int(os.getenv("READ_FILE_BINARY_MAX_BYTES", "68157440"))  # 65MB default
MAX_READ_FILE_LINES = int(os.getenv("READ_FILE_MAX_LINES", "500"))
MAX_AGENTIC_FILE_LINES = 650  # Stricter limit for agentic file tools
MAX_READ_FILE_DOCUMENT_BYTES = int(os.getenv("READ_FILE_DOCUMENT_MAX_BYTES", "52428800"))  # 50MB
MAX_GLOB_RESULTS = int(os.getenv("GLOB_MAX_RESULTS", "20000"))
MAX_GREP_RESULTS = int(os.getenv("GREP_MAX_RESULTS", "2000"))
MAX_GREP_FILE_BYTES = int(os.getenv("GREP_MAX_FILE_BYTES", "5242880"))  # 5MB
CHECKPOINT_DIR = os.environ.get(
    "STUARD_CHECKPOINT_DIR",
    os.path.join(os.environ.get("TMPDIR", "/tmp"), "stuard-checkpoints")
    if os.environ.get("STUARD_AGENT_MODE") == "vm"
    else os.path.expanduser("~/.stuard/checkpoints"),
)

PDF_EXTENSIONS = {".pdf"}
OPENXML_SPREADSHEET_EXTENSIONS = {".xlsx", ".xlsm", ".xltx", ".xltm"}
LEGACY_SPREADSHEET_EXTENSIONS = {".xls"}


def _split_content_lines(content: str) -> list[str]:
    if not content:
        return []
    return content.splitlines(keepends=True)


def _xml_local_name(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[-1]
    return tag


def _xml_collect_text(node: ET.Element) -> str:
    parts: list[str] = []
    for item in node.iter():
        if _xml_local_name(item.tag) == "t" and item.text:
            parts.append(item.text)
    return "".join(parts)


def _excel_column_index(cell_ref: str) -> int:
    letters = []
    for ch in cell_ref:
        if ch.isalpha():
            letters.append(ch.upper())
        else:
            break
    if not letters:
        return 0
    value = 0
    for ch in letters:
        value = value * 26 + (ord(ch) - ord("A") + 1)
    return value


def _extract_xlsx_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    strings: list[str] = []
    for item in root.iter():
        if _xml_local_name(item.tag) == "si":
            strings.append(_xml_collect_text(item))
    return strings


def _extract_xlsx_sheet_map(zf: zipfile.ZipFile) -> list[tuple[str, str]]:
    workbook_path = "xl/workbook.xml"
    rels_path = "xl/_rels/workbook.xml.rels"
    if workbook_path not in zf.namelist():
        raise ValueError("missing workbook.xml")

    rels_by_id: dict[str, str] = {}
    if rels_path in zf.namelist():
        rels_root = ET.fromstring(zf.read(rels_path))
        for rel in rels_root.iter():
            if _xml_local_name(rel.tag) != "Relationship":
                continue
            rel_id = str(rel.attrib.get("Id") or "").strip()
            target = str(rel.attrib.get("Target") or "").strip()
            if not rel_id or not target:
                continue
            normalized = target.lstrip("/")
            if not normalized.startswith("xl/"):
                normalized = f"xl/{normalized}"
            rels_by_id[rel_id] = normalized

    workbook_root = ET.fromstring(zf.read(workbook_path))
    sheets: list[tuple[str, str]] = []
    for sheet in workbook_root.iter():
        if _xml_local_name(sheet.tag) != "sheet":
            continue
        name = str(sheet.attrib.get("name") or "Sheet").strip() or "Sheet"
        rel_id = ""
        for key, value in sheet.attrib.items():
            if key == "id" or key.endswith("}id"):
                rel_id = str(value or "").strip()
                break
        target = rels_by_id.get(rel_id)
        if target:
            sheets.append((name, target))

    if sheets:
        return sheets

    fallback_paths = sorted(
        name for name in zf.namelist()
        if name.startswith("xl/worksheets/") and name.endswith(".xml")
    )
    return [(f"Sheet {idx}", sheet_path) for idx, sheet_path in enumerate(fallback_paths, 1)]


def _extract_xlsx_cell_text(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = str(cell.attrib.get("t") or "").strip()
    if cell_type == "inlineStr":
        for child in cell.iter():
            if _xml_local_name(child.tag) == "is":
                return _xml_collect_text(child)
        return _xml_collect_text(cell)

    value_text = ""
    for child in cell:
        tag = _xml_local_name(child.tag)
        if tag == "v":
            value_text = child.text or ""
            break
        if tag == "is":
            value_text = _xml_collect_text(child)
            break

    if cell_type == "s":
        try:
            index = int(value_text)
            return shared_strings[index] if 0 <= index < len(shared_strings) else ""
        except Exception:
            return ""
    if cell_type == "b":
        return "TRUE" if value_text == "1" else "FALSE"
    return value_text


def _extract_xlsx_sheet_text(zf: zipfile.ZipFile, sheet_path: str, shared_strings: list[str]) -> str:
    root = ET.fromstring(zf.read(sheet_path))
    lines: list[str] = []
    for row in root.iter():
        if _xml_local_name(row.tag) != "row":
            continue
        cells: dict[int, str] = {}
        max_col = 0
        for cell in row:
            if _xml_local_name(cell.tag) != "c":
                continue
            cell_ref = str(cell.attrib.get("r") or "")
            col_idx = _excel_column_index(cell_ref)
            if col_idx <= 0:
                col_idx = max_col + 1
            value = _extract_xlsx_cell_text(cell, shared_strings)
            cells[col_idx] = value
            max_col = max(max_col, col_idx)
        if not cells:
            continue
        row_values = [cells.get(idx, "") for idx in range(1, max_col + 1)]
        while row_values and row_values[-1] == "":
            row_values.pop()
        if not row_values:
            continue
        lines.append("\t".join(row_values))
    return "\n".join(lines)


def _extract_openxml_spreadsheet_text(path: str) -> tuple[str, Dict[str, Any]]:
    try:
        with zipfile.ZipFile(path) as zf:
            shared_strings = _extract_xlsx_shared_strings(zf)
            sheet_map = _extract_xlsx_sheet_map(zf)
            if not sheet_map:
                raise ValueError("no worksheets found")

            sections: list[str] = []
            sheet_names: list[str] = []
            for sheet_name, sheet_path in sheet_map:
                if sheet_path not in zf.namelist():
                    continue
                sheet_names.append(sheet_name)
                sheet_text = _extract_xlsx_sheet_text(zf, sheet_path, shared_strings)
                body = sheet_text if sheet_text.strip() else "(Empty sheet)"
                sections.append(f"[Sheet: {sheet_name}]\n{body}")

            if not sections:
                raise ValueError("no readable worksheet content found")

            return (
                "\n\n".join(sections),
                {
                    "document_type": "spreadsheet",
                    "sheet_names": sheet_names,
                },
            )
    except zipfile.BadZipFile as exc:
        raise ValueError(f"invalid spreadsheet file: {exc}") from exc
    except ET.ParseError as exc:
        raise ValueError(f"invalid spreadsheet XML: {exc}") from exc


def _extract_legacy_spreadsheet_text(path: str) -> tuple[str, Dict[str, Any]]:
    try:
        import xlrd  # type: ignore
    except Exception as exc:
        raise ValueError(
            "legacy .xls spreadsheets are not supported in this environment; convert the file to .xlsx"
        ) from exc

    workbook = xlrd.open_workbook(path)
    sections: list[str] = []
    sheet_names: list[str] = []
    for sheet in workbook.sheets():
        sheet_names.append(sheet.name)
        lines: list[str] = []
        for row_idx in range(sheet.nrows):
            values = [str(sheet.cell_value(row_idx, col_idx)) for col_idx in range(sheet.ncols)]
            while values and values[-1] == "":
                values.pop()
            if values:
                lines.append("\t".join(values))
        body = "\n".join(lines) if lines else "(Empty sheet)"
        sections.append(f"[Sheet: {sheet.name}]\n{body}")

    if not sections:
        raise ValueError("no readable worksheet content found")

    return (
        "\n\n".join(sections),
        {
            "document_type": "spreadsheet",
            "sheet_names": sheet_names,
        },
    )


def _read_pdf_literal_string(data: bytes, start: int) -> tuple[bytes, int]:
    i = start + 1
    depth = 1
    out = bytearray()
    while i < len(data):
        b = data[i]
        if b == 92:  # backslash escape
            out.append(b)
            i += 1
            if i < len(data):
                out.append(data[i])
                i += 1
            continue
        if b == 40:  # (
            depth += 1
            out.append(b)
            i += 1
            continue
        if b == 41:  # )
            depth -= 1
            if depth == 0:
                return bytes(out), i + 1
            out.append(b)
            i += 1
            continue
        out.append(b)
        i += 1
    return bytes(out), i


def _read_pdf_hex_string(data: bytes, start: int) -> tuple[bytes, int]:
    i = start + 1
    out = bytearray()
    while i < len(data):
        b = data[i]
        if b == 62:  # >
            return bytes(out), i + 1
        out.append(b)
        i += 1
    return bytes(out), i


def _decode_pdf_literal_text(raw: bytes) -> str:
    out = bytearray()
    i = 0
    while i < len(raw):
        b = raw[i]
        if b != 92:
            out.append(b)
            i += 1
            continue

        i += 1
        if i >= len(raw):
            break
        esc = raw[i]
        if esc in (110, 114, 116, 98, 102):  # n r t b f
            out.extend({
                110: b"\n",
                114: b"\r",
                116: b"\t",
                98: b"\b",
                102: b"\f",
            }[esc])
            i += 1
            continue
        if esc in (40, 41, 92):  # ( ) \
            out.append(esc)
            i += 1
            continue
        if 48 <= esc <= 55:
            octal = [esc]
            i += 1
            for _ in range(2):
                if i < len(raw) and 48 <= raw[i] <= 55:
                    octal.append(raw[i])
                    i += 1
                else:
                    break
            out.append(int(bytes(octal), 8))
            continue
        if esc == 13:  # \r line continuation
            i += 1
            if i < len(raw) and raw[i] == 10:
                i += 1
            continue
        if esc == 10:  # \n line continuation
            i += 1
            continue
        out.append(esc)
        i += 1

    for encoding in ("utf-8", "latin-1", "utf-16-be"):
        try:
            text = out.decode(encoding)
        except Exception:
            continue
        if text and any(ch.isprintable() for ch in text):
            return text
    return out.decode("latin-1", errors="replace")


def _decode_pdf_hex_text(raw: bytes) -> str:
    cleaned = re.sub(rb"\s+", b"", raw)
    if not cleaned:
        return ""
    if len(cleaned) % 2 == 1:
        cleaned += b"0"
    try:
        data = bytes.fromhex(cleaned.decode("ascii"))
    except Exception:
        return ""
    encodings = ("utf-16-be", "utf-8", "latin-1") if b"\x00" in data else ("utf-8", "latin-1", "utf-16-be")
    for encoding in encodings:
        try:
            text = data.decode(encoding)
        except Exception:
            continue
        if text and any(ch.isprintable() for ch in text):
            return text
    return data.decode("latin-1", errors="replace")


def _extract_pdf_text_fragments(block: bytes) -> list[str]:
    parts: list[str] = []
    i = 0
    while i < len(block):
        b = block[i]
        if b == 40:  # (
            raw, i = _read_pdf_literal_string(block, i)
            text = _decode_pdf_literal_text(raw).strip()
            if text:
                parts.append(text)
            continue
        if b == 60 and i + 1 < len(block) and block[i + 1] != 60:  # <hex>
            raw, i = _read_pdf_hex_string(block, i)
            text = _decode_pdf_hex_text(raw).strip()
            if text:
                parts.append(text)
            continue
        i += 1
    return parts


def _decode_pdf_stream(dict_bytes: bytes, stream_data: bytes) -> bytes:
    payload = stream_data.strip(b"\r\n")
    if b"/FlateDecode" in dict_bytes:
        try:
            return zlib.decompress(payload)
        except Exception:
            try:
                return zlib.decompress(payload, -15)
            except Exception:
                return b""
    return payload


def _extract_pdf_text_fallback(path: str) -> tuple[str, Dict[str, Any]]:
    with open(path, "rb") as f:
        pdf_bytes = f.read()

    streams: list[bytes] = []
    for match in re.finditer(rb"<<(.*?)>>\s*stream\r?\n(.*?)\r?\nendstream", pdf_bytes, re.DOTALL):
        decoded = _decode_pdf_stream(match.group(1), match.group(2))
        if decoded:
            streams.append(decoded)

    if not streams:
        streams = [pdf_bytes]

    blocks: list[str] = []
    for stream in streams:
        for match in re.finditer(rb"BT(.*?)ET", stream, re.DOTALL):
            fragments = _extract_pdf_text_fragments(match.group(1))
            if fragments:
                blocks.append("\n".join(fragments))

    if not blocks:
        raise ValueError("no extractable text found in PDF")

    page_count = len(re.findall(rb"/Type\s*/Page\b", pdf_bytes))
    metadata: Dict[str, Any] = {
        "document_type": "pdf",
    }
    if page_count > 0:
        metadata["page_count"] = page_count
    return "\n\n".join(blocks), metadata


def _is_meaningful_text(text: str, threshold: float = 0.3) -> bool:
    """Check if extracted text is mostly readable (not binary garbage)."""
    if not text:
        return False
    sample = text[:2000]
    printable = sum(1 for ch in sample if ch.isprintable() or ch in '\n\r\t')
    return (printable / len(sample)) >= threshold


def _extract_pdf_text(path: str) -> tuple[str, Dict[str, Any]]:
    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(path)
        pages: list[str] = []
        for idx, page in enumerate(reader.pages, 1):
            text = (page.extract_text() or "").strip()
            if text:
                pages.append(f"[Page {idx}]\n{text}")
        if pages:
            combined = "\n\n".join(pages)
            if _is_meaningful_text(combined):
                return (
                    combined,
                    {
                        "document_type": "pdf",
                        "page_count": len(reader.pages),
                    },
                )
    except ImportError:
        pass
    except Exception:
        pass

    # Try raw-stream fallback
    try:
        text, metadata = _extract_pdf_text_fallback(path)
        if _is_meaningful_text(text):
            return text, metadata
    except Exception:
        pass

    # Count pages even when text extraction fails
    page_count = 0
    try:
        with open(path, "rb") as f:
            page_count = len(re.findall(rb"/Type\s*/Page\b", f.read()))
    except Exception:
        pass

    raise ValueError(
        f"Could not extract readable text from PDF ({page_count} pages). "
        "The file may be image-based (scanned) or use non-standard encoding. "
        "Install 'pypdf' for best results: pip install pypdf"
    )


def _read_text_like_file(path: str) -> Dict[str, Any]:
    ext = os.path.splitext(path)[1].lower()
    metadata: Dict[str, Any] = {
        "path": path,
        "mime_type": mimetypes.guess_type(path)[0] or "application/octet-stream",
    }

    if ext in PDF_EXTENSIONS | OPENXML_SPREADSHEET_EXTENSIONS | LEGACY_SPREADSHEET_EXTENSIONS:
        size = os.path.getsize(path)
        if size > MAX_READ_FILE_DOCUMENT_BYTES:
            raise ValueError(
                f"file is too large to extract text ({size} bytes > {MAX_READ_FILE_DOCUMENT_BYTES} bytes)"
            )

    if ext in PDF_EXTENSIONS:
        content, doc_meta = _extract_pdf_text(path)
        metadata.update(doc_meta)
        lines = _split_content_lines(content)
        return {"content": content, "lines": lines, **metadata}

    if ext in OPENXML_SPREADSHEET_EXTENSIONS:
        content, doc_meta = _extract_openxml_spreadsheet_text(path)
        metadata.update(doc_meta)
        lines = _split_content_lines(content)
        return {"content": content, "lines": lines, **metadata}

    if ext in LEGACY_SPREADSHEET_EXTENSIONS:
        content, doc_meta = _extract_legacy_spreadsheet_text(path)
        metadata.update(doc_meta)
        lines = _split_content_lines(content)
        return {"content": content, "lines": lines, **metadata}

    with open(path, "r", encoding="utf-8", errors="replace") as f:
        lines = f.readlines()
    return {"content": "".join(lines), "lines": lines, **metadata}

class CheckpointManager:
    _active_id: str | None = None
    _redo_stack: list[str] = []
    
    @classmethod
    def set_active(cls, id: str):
        cls._active_id = id
        
    @classmethod
    def get_active(cls) -> str | None:
        return cls._active_id
        
    @classmethod
    def list_checkpoints(cls) -> list[Dict[str, Any]]:
        if not os.path.exists(CHECKPOINT_DIR):
            return []
        res = []
        for name in os.listdir(CHECKPOINT_DIR):
            mp = os.path.join(CHECKPOINT_DIR, name, "manifest.json")
            if os.path.exists(mp):
                try:
                    with open(mp, "r") as f:
                        data = json.load(f)
                    data["canRedo"] = name in cls._redo_stack
                    res.append(data)
                except Exception:
                    pass
        res.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        return res

    @classmethod
    def create(cls, name: str = "checkpoint") -> str:
        ts = int(time.time())
        id = f"{ts}_{uuid.uuid4().hex[:8]}_{name}"
        path = os.path.join(CHECKPOINT_DIR, id)
        os.makedirs(path, exist_ok=True)
        manifest = {
            "id": id,
            "timestamp": ts,
            "name": name,
            "files": {},
        }
        with open(os.path.join(path, "manifest.json"), "w") as f:
            json.dump(manifest, f)
        
        cls._active_id = id
        cls._redo_stack = []
        return id

    @classmethod
    def cleanup_old(cls, max_age_hours: int = 24, max_count: int = 15):
        """Remove old checkpoints to save disk space, preserving redo entries."""
        if not os.path.exists(CHECKPOINT_DIR):
            return
        
        now = time.time()
        max_age_secs = max_age_hours * 3600
        checkpoints = cls.list_checkpoints()
        
        for i, cp in enumerate(checkpoints):
            cp_id = cp.get("id", "")
            cp_ts = cp.get("timestamp", 0)
            age = now - cp_ts
            
            if i < 5:
                continue
            
            if cp_id in cls._redo_stack:
                continue
            
            if age > max_age_secs or i >= max_count:
                try:
                    cp_path = os.path.join(CHECKPOINT_DIR, cp_id)
                    if os.path.exists(cp_path):
                        shutil.rmtree(cp_path)
                except Exception:
                    pass

    @classmethod
    def ensure_active(cls) -> str:
        """Auto-create a checkpoint if none is active. Returns the active checkpoint ID."""
        cls.cleanup_old()
        
        if cls._active_id:
            cp_path = os.path.join(CHECKPOINT_DIR, cls._active_id)
            if os.path.exists(cp_path):
                return cls._active_id
        return cls.create("auto")

    @classmethod
    def record_change(cls, file_path: str, operation: str = "modify"):
        cls.ensure_active()
        
        if not cls._active_id:
            return
            
        cp_path = os.path.join(CHECKPOINT_DIR, cls._active_id)
        if not os.path.exists(cp_path):
            return
            
        manifest_path = os.path.join(cp_path, "manifest.json")
        try:
            with open(manifest_path, "r") as f:
                manifest = json.load(f)
        except Exception:
            return

        file_path = os.path.abspath(file_path)
        
        if file_path in manifest["files"]:
            return
            
        entry = {"action": operation, "path": file_path}
        
        if os.path.exists(file_path) and operation != "create":
            backup_name = base64.urlsafe_b64encode(file_path.encode()).decode()
            backup_file = os.path.join(cp_path, backup_name)
            try:
                if os.path.isdir(file_path):
                    shutil.copytree(file_path, backup_file)
                    entry["backup"] = backup_name
                    entry["backup_type"] = "dir"
                    entry["action"] = "modify"
                else:
                    shutil.copy2(file_path, backup_file)
                    entry["backup"] = backup_name
                    entry["backup_type"] = "file"
                    entry["action"] = "modify" 
            except Exception as e:
                print(f"Failed to backup {file_path}: {e}")
                return
        elif operation == "create":
            entry["action"] = "create" 

        manifest["files"][file_path] = entry
        
        with open(manifest_path, "w") as f:
            json.dump(manifest, f)

    @classmethod
    def _snapshot_current_state(cls, manifest: Dict[str, Any], cp_path: str) -> str:
        """Capture current (post-change) state of tracked files so we can redo later."""
        ts = int(time.time())
        redo_id = f"{ts}_{uuid.uuid4().hex[:8]}_redo"
        redo_path = os.path.join(CHECKPOINT_DIR, redo_id)
        os.makedirs(redo_path, exist_ok=True)
        
        redo_manifest = {
            "id": redo_id,
            "timestamp": ts,
            "name": "redo",
            "source_checkpoint": manifest.get("id", ""),
            "files": {},
        }
        
        for path, info in manifest["files"].items():
            action = info.get("action")
            redo_entry: Dict[str, Any] = {"path": path}
            
            try:
                if action == "create":
                    if os.path.exists(path):
                        backup_name = base64.urlsafe_b64encode(path.encode()).decode()
                        backup_file = os.path.join(redo_path, backup_name)
                        if os.path.isdir(path):
                            shutil.copytree(path, backup_file)
                            redo_entry["backup"] = backup_name
                            redo_entry["backup_type"] = "dir"
                        else:
                            shutil.copy2(path, backup_file)
                            redo_entry["backup"] = backup_name
                            redo_entry["backup_type"] = "file"
                        redo_entry["action"] = "restore"
                    else:
                        redo_entry["action"] = "delete"
                elif action == "modify":
                    if os.path.exists(path):
                        backup_name = base64.urlsafe_b64encode(path.encode()).decode()
                        backup_file = os.path.join(redo_path, backup_name)
                        if os.path.isdir(path):
                            shutil.copytree(path, backup_file)
                            redo_entry["backup"] = backup_name
                            redo_entry["backup_type"] = "dir"
                        else:
                            shutil.copy2(path, backup_file)
                            redo_entry["backup"] = backup_name
                            redo_entry["backup_type"] = "file"
                        redo_entry["action"] = "restore"
                    else:
                        redo_entry["action"] = "delete"
            except Exception as e:
                print(f"Redo snapshot failed for {path}: {e}")
                continue
            
            redo_manifest["files"][path] = redo_entry
        
        with open(os.path.join(redo_path, "manifest.json"), "w") as f:
            json.dump(redo_manifest, f)
        
        return redo_id

    @classmethod
    def restore(cls, id: str) -> Dict[str, Any]:
        cp_path = os.path.join(CHECKPOINT_DIR, id)
        manifest_path = os.path.join(cp_path, "manifest.json")
        if not os.path.exists(manifest_path):
            raise ValueError(f"Checkpoint {id} not found")
            
        with open(manifest_path, "r") as f:
            manifest = json.load(f)
        
        redo_id = None
        try:
            redo_id = cls._snapshot_current_state(manifest, cp_path)
        except Exception as e:
            print(f"Warning: failed to create redo snapshot: {e}")
            
        restored = []
        errors = []
        skipped = []
        
        for path, info in manifest["files"].items():
            try:
                action = info.get("action")
                if action == "create":
                    if os.path.exists(path):
                        if os.path.isdir(path):
                            shutil.rmtree(path)
                        else:
                            os.remove(path)
                        restored.append(path)
                    else:
                        skipped.append(path)
                elif action == "modify" and "backup" in info:
                    backup_path = os.path.join(cp_path, info["backup"])
                    backup_type = info.get("backup_type") or "file"
                    if os.path.exists(backup_path):
                        if backup_type == "dir":
                            if os.path.exists(path):
                                if os.path.isdir(path):
                                    shutil.rmtree(path)
                                else:
                                    os.remove(path)
                            parent = os.path.dirname(path)
                            if parent and not os.path.exists(parent):
                                os.makedirs(parent, exist_ok=True)
                            shutil.copytree(backup_path, path)
                        else:
                            d = os.path.dirname(path)
                            if d and not os.path.exists(d):
                                os.makedirs(d, exist_ok=True)
                            shutil.copy2(backup_path, path)
                        restored.append(path)
                    else:
                        errors.append(f"{path}: backup file missing")
                elif action == "modify" and "backup" not in info:
                    skipped.append(path)
            except Exception as e:
                errors.append(f"{path}: {e}")
        
        if redo_id:
            if id not in cls._redo_stack:
                cls._redo_stack.append(id)

        return {
            "ok": True,
            "restored": len(restored),
            "restored_files": restored,
            "skipped": len(skipped),
            "errors": errors,
            "redo_id": redo_id,
            "can_redo": bool(redo_id),
        }

    @classmethod
    def redo(cls, checkpoint_id: str) -> Dict[str, Any]:
        """Re-apply changes that were previously reverted for a given checkpoint."""
        redo_entries = []
        if not os.path.exists(CHECKPOINT_DIR):
            raise ValueError("No redo data found")
        
        for name in os.listdir(CHECKPOINT_DIR):
            mp = os.path.join(CHECKPOINT_DIR, name, "manifest.json")
            if os.path.exists(mp):
                try:
                    with open(mp, "r") as f:
                        data = json.load(f)
                    if data.get("source_checkpoint") == checkpoint_id:
                        redo_entries.append(data)
                except Exception:
                    pass
        
        if not redo_entries:
            raise ValueError(f"No redo data for checkpoint {checkpoint_id}")
        
        redo_entries.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        redo = redo_entries[0]
        redo_id = redo["id"]
        redo_path = os.path.join(CHECKPOINT_DIR, redo_id)
        
        restored = []
        errors = []
        
        for path, info in redo["files"].items():
            try:
                action = info.get("action")
                if action == "restore" and "backup" in info:
                    backup_path = os.path.join(redo_path, info["backup"])
                    backup_type = info.get("backup_type") or "file"
                    if os.path.exists(backup_path):
                        if backup_type == "dir":
                            if os.path.exists(path):
                                if os.path.isdir(path):
                                    shutil.rmtree(path)
                                else:
                                    os.remove(path)
                            parent = os.path.dirname(path)
                            if parent and not os.path.exists(parent):
                                os.makedirs(parent, exist_ok=True)
                            shutil.copytree(backup_path, path)
                        else:
                            d = os.path.dirname(path)
                            if d and not os.path.exists(d):
                                os.makedirs(d, exist_ok=True)
                            shutil.copy2(backup_path, path)
                        restored.append(path)
                elif action == "delete":
                    if os.path.exists(path):
                        if os.path.isdir(path):
                            shutil.rmtree(path)
                        else:
                            os.remove(path)
                        restored.append(path)
            except Exception as e:
                errors.append(f"{path}: {e}")
        
        if checkpoint_id in cls._redo_stack:
            cls._redo_stack.remove(checkpoint_id)
        
        try:
            if os.path.exists(redo_path):
                shutil.rmtree(redo_path)
        except Exception:
            pass
        
        return {
            "ok": True,
            "restored": len(restored),
            "restored_files": restored,
            "errors": errors,
        }

async def list_directory(args: Dict[str, Any]) -> Dict[str, Any]:
    p = str(args.get("path") or ".").strip()
    if not p:
        p = "."
    p = os.path.expanduser(p)
    if not _is_safe_path(p):
        raise ValueError(f"Access denied to system path: {p}")
    _check_folder_read(p, args)
    names = []
    try:
        for name in os.listdir(p):
            full = os.path.join(p, name)
            typ = "dir" if os.path.isdir(full) else "file"
            names.append({"name": name, "type": typ})
    except FileNotFoundError:
        raise ValueError(f"path not found: {p}")
    return {"ok": True, "items": names}


async def read_file(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Read text file contents with optional line range.
    
    Args:
        path: File path to read
        line_start: Starting line number (1-indexed, inclusive). Optional.
        line_end: Ending line number (1-indexed, inclusive). Optional.
    
    If file exceeds MAX_READ_FILE_LINES (default 500) and no line range is specified,
    returns an error with file metadata instead of content.
    """
    p = str(args.get("path") or "").strip()
    if not p:
        raise ValueError("missing path")
    p = os.path.expanduser(p)
    if not _is_safe_path(p):
        raise ValueError(f"Access denied to system path: {p}")
    _check_folder_read(p, args)
    if not os.path.exists(p):
        raise ValueError(f"path not found: {p}")
    if os.path.isdir(p):
        raise ValueError(f"path is a directory, not a file: {p}")
    
    # Get optional line range (1-indexed)
    line_start = args.get("line_start") or args.get("lineStart")
    line_end = args.get("line_end") or args.get("lineEnd")
    
    # Convert to int if provided
    if line_start is not None:
        line_start = int(line_start)
    if line_end is not None:
        line_end = int(line_end)
    
    file_payload = _read_text_like_file(p)
    lines = file_payload["lines"]
    base_result: Dict[str, Any] = {
        "path": file_payload.get("path", p),
    }
    for _k in ("mime_type", "document_type", "sheet_names", "page_count"):
        _v = file_payload.get(_k)
        if _v is not None:
            base_result[_k] = _v
    
    total_lines = len(lines)
    
    # If no line range specified and file is too large, return error with metadata
    if line_start is None and line_end is None and total_lines > MAX_READ_FILE_LINES:
        # Return first few and last few lines as preview
        preview_lines = 10
        first_lines = "".join(lines[:preview_lines])
        last_lines = "".join(lines[-preview_lines:]) if total_lines > preview_lines * 2 else ""
        
        return {
            "ok": False,
            "error": "file_too_large",
            "message": f"File has {total_lines} lines which exceeds the {MAX_READ_FILE_LINES} line limit. Use line_start and line_end parameters to read specific portions.",
            **base_result,
            "total_lines": total_lines,
            "max_lines": MAX_READ_FILE_LINES,
            "preview_start": first_lines,
            "preview_end": last_lines,
            "hint": f"Try: line_start=1, line_end={MAX_READ_FILE_LINES} to read the first {MAX_READ_FILE_LINES} lines"
        }
    
    # Apply line range if specified (convert to 0-indexed)
    if line_start is not None or line_end is not None:
        start_idx = (line_start - 1) if line_start else 0
        end_idx = line_end if line_end else total_lines
        
        # Clamp to valid range
        start_idx = max(0, min(start_idx, total_lines))
        end_idx = max(0, min(end_idx, total_lines))
        
        lines = lines[start_idx:end_idx]
        content = "".join(lines)
        
        return {
            "ok": True,
            "content": content,
            "line_start": start_idx + 1,
            "line_end": start_idx + len(lines),
            "lines_returned": len(lines),
            "total_lines": total_lines,
            **base_result,
        }
    
    # Return full content for small files
    content = "".join(lines)
    return {"ok": True, "content": content, "total_lines": total_lines, **base_result}


async def glob_paths(args: Dict[str, Any]) -> Dict[str, Any]:
    pattern = str(args.get("pattern") or args.get("glob") or "").strip()
    if not pattern:
        return {"ok": False, "error": "missing pattern"}

    root = str(args.get("root") or args.get("base_path") or args.get("cwd") or "").strip()
    recursive = bool(args.get("recursive", True))
    include_files = args.get("include_files")
    include_dirs = args.get("include_dirs")
    if include_files is None:
        include_files = True
    if include_dirs is None:
        include_dirs = True
    max_results = int(args.get("max_results") or MAX_GLOB_RESULTS)
    if max_results <= 0:
        max_results = MAX_GLOB_RESULTS

    if root:
        root = os.path.expanduser(root)
        if not _is_safe_path(root):
            return {"ok": False, "error": f"Access denied to system path: {root}"}
        _check_folder_read(root, args)
        pattern_path = os.path.join(root, pattern) if not os.path.isabs(pattern) else pattern
    else:
        pattern_path = pattern

    pattern_path = os.path.expanduser(pattern_path)

    try:
        matches = glob.glob(pattern_path, recursive=recursive)
    except Exception as e:
        return {"ok": False, "error": f"glob_failed: {str(e)}"}

    items = []
    truncated = False
    for m in sorted(matches):
        if not _is_safe_path(m):
            continue
        typ = "dir" if os.path.isdir(m) else "file"
        if typ == "dir" and not include_dirs:
            continue
        if typ == "file" and not include_files:
            continue
        items.append({"path": m, "type": typ})
        if len(items) >= max_results:
            truncated = True
            break

    return {"ok": True, "items": items, "count": len(items), "truncated": truncated}


async def grep(args: Dict[str, Any]) -> Dict[str, Any]:
    import re

    p = str(args.get("path") or "").strip()
    pattern = str(args.get("pattern") or args.get("query") or "").strip()

    if not p:
        return {"ok": False, "error": "missing path"}
    if not pattern:
        return {"ok": False, "error": "missing pattern"}

    p = os.path.expanduser(p)
    if not _is_safe_path(p):
        return {"ok": False, "error": f"Access denied to system path: {p}"}
    _check_folder_read(p, args)

    regex = args.get("regex")
    if regex is None:
        regex = True
    case_sensitive = args.get("case_sensitive")
    if case_sensitive is None:
        case_sensitive = True

    include_glob = args.get("include_glob") or args.get("includeGlob")
    exclude_glob = args.get("exclude_glob") or args.get("excludeGlob")
    max_results = int(args.get("max_results") or MAX_GREP_RESULTS)
    if max_results <= 0:
        max_results = MAX_GREP_RESULTS
    max_file_size = int(args.get("max_file_size") or MAX_GREP_FILE_BYTES)
    if max_file_size < 0:
        max_file_size = MAX_GREP_FILE_BYTES

    def normalize_globs(val: Any) -> list[str]:
        if val is None:
            return []
        if isinstance(val, (list, tuple)):
            return [str(v) for v in val if str(v).strip()]
        v = str(val).strip()
        return [v] if v else []

    includes = normalize_globs(include_glob)
    excludes = normalize_globs(exclude_glob)

    flags = 0 if case_sensitive else re.IGNORECASE
    if regex:
        try:
            rx = re.compile(pattern, flags)
        except re.error as e:
            return {"ok": False, "error": f"invalid_regex: {str(e)}"}
    else:
        rx = re.compile(re.escape(pattern), flags)

    files: list[str] = []
    if os.path.isfile(p):
        files = [p]
    elif os.path.isdir(p):
        for root, _, filenames in os.walk(p):
            for name in filenames:
                if includes and not any(fnmatch.fnmatch(name, g) for g in includes):
                    continue
                if excludes and any(fnmatch.fnmatch(name, g) for g in excludes):
                    continue
                files.append(os.path.join(root, name))
    else:
        return {"ok": False, "error": f"path not found: {p}"}

    document_extensions = PDF_EXTENSIONS | OPENXML_SPREADSHEET_EXTENSIONS | LEGACY_SPREADSHEET_EXTENSIONS

    results = []
    truncated = False
    skipped_too_large = 0

    for fp in files:
        if not _is_safe_path(fp):
            continue
        try:
            file_size = os.path.getsize(fp)
            ext = os.path.splitext(fp)[1].lower()

            if ext in document_extensions:
                # Extract text from documents (PDF, XLSX, XLS) then search
                if file_size > MAX_READ_FILE_DOCUMENT_BYTES:
                    skipped_too_large += 1
                    continue
                try:
                    payload = _read_text_like_file(fp)
                    lines = payload.get("lines", [])
                except Exception:
                    continue
                for line_no, line in enumerate(lines, 1):
                    line_text = line.rstrip("\n")
                    m = rx.search(line_text)
                    if not m:
                        continue
                    results.append({
                        "path": fp,
                        "line_number": line_no,
                        "line": line_text,
                        "match": m.group(0),
                        "document_type": ext.lstrip("."),
                    })
                    if len(results) >= max_results:
                        truncated = True
                        break
            else:
                # Plain text files — read directly
                if max_file_size and file_size > max_file_size:
                    skipped_too_large += 1
                    continue
                with open(fp, "r", encoding="utf-8", errors="replace") as f:
                    for line_no, line in enumerate(f, 1):
                        m = rx.search(line)
                        if not m:
                            continue
                        results.append({
                            "path": fp,
                            "line_number": line_no,
                            "line": line.rstrip("\n"),
                            "match": m.group(0)
                        })
                        if len(results) >= max_results:
                            truncated = True
                            break
            if truncated:
                break
        except Exception:
            continue

    return {
        "ok": True,
        "results": results,
        "count": len(results),
        "truncated": truncated,
        "skipped_too_large": skipped_too_large
    }


async def write_file(args: Dict[str, Any]) -> Dict[str, Any]:
    p = str(args.get("path") or "").strip()
    content = str(args.get("content") or "")
    append = bool(args.get("append") or False)
    if not p:
        raise ValueError("missing path")
    p = os.path.expanduser(p)
    if not _is_safe_path(p):
        raise ValueError(f"Access denied to system path: {p}")
    _check_folder_write(p, args)
    d = os.path.dirname(p)
    
    # Checkpoint
    op = "create" if not os.path.exists(p) else "modify"
    CheckpointManager.record_change(p, op)

    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)
    mode = "a" if append else "w"
    with open(p, mode, encoding="utf-8") as f:
        f.write(content)
    return {"ok": True}


async def write_file_base64(args: Dict[str, Any]) -> Dict[str, Any]:
    p = str(args.get("path") or "").strip()
    data_b64 = str(args.get("content") or args.get("data") or "")
    if not p:
        raise ValueError("missing path")
    if not data_b64:
         raise ValueError("missing content/data")
    
    p = os.path.expanduser(p)
    if not _is_safe_path(p):
        raise ValueError(f"Access denied to system path: {p}")
    _check_folder_write(p, args)
        
    d = os.path.dirname(p)
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)

    # Checkpoint
    op = "create" if not os.path.exists(p) else "modify"
    CheckpointManager.record_change(p, op)

    try:
        data = base64.b64decode(data_b64)
    except Exception as e:
        raise ValueError(f"Invalid base64 data: {e}")

    with open(p, "wb") as f:
        f.write(data)
        
    return {"ok": True, "path": p, "size": len(data)}


async def create_directory(args: Dict[str, Any]) -> Dict[str, Any]:
    p = str(args.get("path") or "").strip()
    if not p:
        raise ValueError("missing path")
    p = os.path.expanduser(p)
    if not _is_safe_path(p):
        raise ValueError(f"Access denied to system path: {p}")
    _check_folder_write(p, args)

    # Checkpoint
    if not os.path.exists(p):
        CheckpointManager.record_change(p, "create")

    os.makedirs(p, exist_ok=True)
    return {"ok": True}


async def move_file(args: Dict[str, Any]) -> Dict[str, Any]:
    src = str(args.get("src") or "").strip()
    dest = str(args.get("dest") or "").strip()
    if not src or not dest:
        raise ValueError("missing src/dest")
    src = os.path.expanduser(src)
    dest = os.path.expanduser(dest)
    
    if not _is_safe_path(src):
        raise ValueError(f"Access denied to system path: {src}")
    if not _is_safe_path(dest):
        raise ValueError(f"Access denied to system path: {dest}")
    _check_folder_read(src, args)
    _check_folder_write(dest, args)
    
    # Checkpoint
    CheckpointManager.record_change(src, "modify") # Will become deleted at src
    op_dest = "create" if not os.path.exists(dest) else "modify"
    CheckpointManager.record_change(dest, op_dest)

    d = os.path.dirname(dest)
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)
    shutil.move(src, dest)
    return {"ok": True}

async def copy_file(args: Dict[str, Any]) -> Dict[str, Any]:
    src = str(args.get("src") or "").strip()
    dest = str(args.get("dest") or "").strip()
    if not src or not dest:
        raise ValueError("missing src/dest")
    src = os.path.expanduser(src)
    dest = os.path.expanduser(dest)
    
    if not _is_safe_path(src):
        raise ValueError(f"Access denied to system path: {src}")
    if not _is_safe_path(dest):
        raise ValueError(f"Access denied to system path: {dest}")
    _check_folder_read(src, args)
    _check_folder_write(dest, args)
    
    # Checkpoint
    op_dest = "create" if not os.path.exists(dest) else "modify"
    CheckpointManager.record_change(dest, op_dest)

    d = os.path.dirname(dest)
    if d and not os.path.exists(d):
        os.makedirs(d, exist_ok=True)
    shutil.copy2(src, dest)
    return {"ok": True}

async def delete_file(args: Dict[str, Any]) -> Dict[str, Any]:
    p = str(args.get("path") or "").strip()
    if not p:
        raise ValueError("missing path")
    p = os.path.expanduser(p)
    
    if not _is_safe_path(p):
        raise ValueError(f"Access denied to system path: {p}")
    _check_folder_write(p, args)
    
    if os.path.exists(p):
        CheckpointManager.record_change(p, "modify") # Will be deleted
        if os.path.isdir(p):
            shutil.rmtree(p)
        else:
            os.remove(p)
    return {"ok": True}

# Checkpoint Tools

async def checkpoint_create(args: Dict[str, Any]) -> Dict[str, Any]:
    name = str(args.get("name") or "manual")
    cid = CheckpointManager.create(name)
    return {"ok": True, "id": cid}

async def checkpoint_restore(args: Dict[str, Any]) -> Dict[str, Any]:
    cid = str(args.get("id") or "")
    if not cid:
        cid = CheckpointManager.get_active()
        if not cid:
             checkpoints = CheckpointManager.list_checkpoints()
             if checkpoints:
                 cid = checkpoints[0]["id"]
    
    if not cid:
        raise ValueError("No checkpoint specified or found")
        
    res = CheckpointManager.restore(cid)
    return res

async def checkpoint_redo(args: Dict[str, Any]) -> Dict[str, Any]:
    cid = str(args.get("id") or args.get("checkpoint_id") or "")
    if not cid:
        raise ValueError("No checkpoint ID specified for redo")
    res = CheckpointManager.redo(cid)
    return res

async def checkpoint_list(args: Dict[str, Any]) -> Dict[str, Any]:
    return {"ok": True, "checkpoints": CheckpointManager.list_checkpoints()}



async def open_file(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Open a file or directory with the system default application.
    """
    p = str(args.get("path") or args.get("filePath") or args.get("uri") or "").strip()
    if not p:
        raise ValueError("missing path")

    if p.startswith("file://"):
        try:
            from urllib.parse import urlsplit, unquote

            u = urlsplit(p)
            merged = (u.netloc + u.path) if u.netloc else u.path
            p = unquote(merged)
        except Exception:
            p = p.replace("file:///", "").replace("file://", "")

    p = os.path.expanduser(p)
    p = os.path.normpath(p)

    if not os.path.exists(p):
        return {"ok": False, "error": f"path not found: {p}"}

    try:
        if sys.platform.startswith("win"):
            os.startfile(p)  # type: ignore[attr-defined]
            method = "startfile"
        elif sys.platform == "darwin":
            subprocess.Popen(["open", p])
            method = "open"
        else:
            opener = shutil.which("xdg-open")
            if opener:
                subprocess.Popen([opener, p])
                method = "xdg-open"
            else:
                return {"ok": False, "error": "no_opener", "path": p}

        return {"ok": True, "opened": p, "method": method}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def read_file_binary(args: Dict[str, Any]) -> Dict[str, Any]:
    p = str(args.get("path") or args.get("filePath") or args.get("uri") or "").strip()
    if not p:
        raise ValueError("missing path")
    if p.startswith("file://"):
        try:
            from urllib.parse import urlsplit, unquote
            u = urlsplit(p)
            merged = (u.netloc + u.path) if u.netloc else u.path
            p = unquote(merged)
        except Exception:
            p = p.replace("file:///", "").replace("file://", "")
    p = os.path.expanduser(p)
    p = os.path.normpath(p)
    if not _is_safe_path(p):
        raise ValueError(f"Access denied to system path: {p}")
    _check_folder_read(p, args)
    if not os.path.isfile(p):
        raise ValueError(f"path not found: {p}")
    size = os.path.getsize(p)
    if size > MAX_READ_FILE_BINARY_BYTES:
        return {"ok": False, "error": "file_too_large", "path": p, "size": size, "max": MAX_READ_FILE_BINARY_BYTES}
    with open(p, "rb") as f:
        data = f.read()
    mime, _ = mimetypes.guess_type(p)
    b64 = base64.b64encode(data).decode("ascii")
    return {"ok": True, "data": b64, "mimeType": mime or "application/octet-stream", "path": p, "size": len(data)}


# ═══════════════════════════════════════════════════════════════════════════════
# AGENTIC FILE TOOLS - For AI Agents (Stuard & Workflow Agent)
# ═══════════════════════════════════════════════════════════════════════════════

async def file_read(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Read file contents with line range support for AI agents.

    Modes:
    1. whole_file=True: Read entire file (errors if > 650 lines)
    2. line_start/line_end: Read specific line range (1-indexed, inclusive)

    Returns content with line numbers prefixed for easy reference.
    """
    p = str(args.get("path") or "").strip()
    if not p:
        return {"ok": False, "error": "missing path"}

    p = os.path.expanduser(p)
    if not _is_safe_path(p):
        return {"ok": False, "error": f"Access denied to system path: {p}"}
    _check_folder_read(p, args)

    if not os.path.exists(p):
        return {"ok": False, "error": f"File not found: {p}"}

    if os.path.isdir(p):
        return {"ok": False, "error": f"Path is a directory, not a file: {p}"}

    whole_file = bool(args.get("whole_file") or args.get("wholeFile"))
    line_start = args.get("line_start") or args.get("lineStart")
    line_end = args.get("line_end") or args.get("lineEnd")

    # Convert to int if provided
    if line_start is not None:
        line_start = int(line_start)
    if line_end is not None:
        line_end = int(line_end)

    try:
        file_payload = _read_text_like_file(p)
        lines = file_payload["lines"]
    except Exception as e:
        return {"ok": False, "error": f"Failed to read file: {str(e)}"}

    metadata: Dict[str, Any] = {
        "path": file_payload.get("path", p),
    }
    for _k in ("mime_type", "document_type", "sheet_names", "page_count"):
        _v = file_payload.get(_k)
        if _v is not None:
            metadata[_k] = _v

    total_lines = len(lines)

    # Mode 1: whole_file=True - read entire file but enforce limit
    if whole_file:
        if total_lines > MAX_AGENTIC_FILE_LINES:
            return {
                "ok": False,
                "error": "file_too_large",
                "message": f"File has {total_lines} lines which exceeds the {MAX_AGENTIC_FILE_LINES} line limit for whole_file mode.",
                "total_lines": total_lines,
                "max_lines": MAX_AGENTIC_FILE_LINES,
                "truncated": True,
                "hint": f"Use line_start and line_end to read specific portions (e.g., line_start=1, line_end={MAX_AGENTIC_FILE_LINES})",
                **metadata,
            }

        # Return full content with line numbers
        numbered_lines = []
        for i, line in enumerate(lines, 1):
            numbered_lines.append(f"{i:6d}\t{line.rstrip()}")

        return {
            "ok": True,
            "content": "\n".join(numbered_lines),
            "total_lines": total_lines,
            "line_start": 1,
            "line_end": total_lines,
            "lines_returned": total_lines,
            "truncated": False,
            **metadata,
        }

    # Mode 2: line_start/line_end specified - read range
    if line_start is not None or line_end is not None:
        start_idx = (line_start - 1) if line_start else 0
        end_idx = line_end if line_end else total_lines

        # Clamp to valid range
        start_idx = max(0, min(start_idx, total_lines))
        end_idx = max(0, min(end_idx, total_lines))

        if start_idx >= end_idx:
            return {
                "ok": False,
                "error": "invalid_range",
                "message": f"Invalid line range: {line_start or 1} to {line_end or total_lines}. File has {total_lines} lines.",
                "total_lines": total_lines,
                **metadata,
            }

        selected_lines = lines[start_idx:end_idx]

        # Return content with line numbers
        numbered_lines = []
        for i, line in enumerate(selected_lines, start_idx + 1):
            numbered_lines.append(f"{i:6d}\t{line.rstrip()}")

        return {
            "ok": True,
            "content": "\n".join(numbered_lines),
            "total_lines": total_lines,
            "line_start": start_idx + 1,
            "line_end": start_idx + len(selected_lines),
            "lines_returned": len(selected_lines),
            "truncated": False,
            **metadata,
        }

    # Mode 3: No mode specified - require explicit mode
    return {
        "ok": False,
        "error": "mode_required",
        "message": "You must specify either whole_file=true or provide line_start/line_end.",
        "total_lines": total_lines,
        "hint": f"Use whole_file=true for files under {MAX_AGENTIC_FILE_LINES} lines, or line_start/line_end for larger files.",
        **metadata,
    }


async def file_edit(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Edit file contents using string-based matching for AI agents.

    Modes:
    - replace: Find old_string and replace with new_string (fails if not unique unless replace_all=true)
    - insert_before: Insert new_string before old_string
    - insert_after: Insert new_string after old_string
    - delete: Delete old_string from the file
    - regex: Use regex pattern matching (old_string is the pattern)
    """
    import re

    p = str(args.get("path") or "").strip()
    if not p:
        return {"ok": False, "error": "missing path"}

    p = os.path.expanduser(p)
    if not _is_safe_path(p):
        return {"ok": False, "error": f"Access denied to system path: {p}"}
    _check_folder_write(p, args)

    mode = str(args.get("mode") or "replace").lower()
    valid_modes = ("replace", "insert_before", "insert_after", "delete", "regex")
    if mode not in valid_modes:
        return {"ok": False, "error": f"Invalid mode: {mode}. Use one of: {', '.join(valid_modes)}"}

    # String-based params
    old_string = args.get("old_string") or args.get("oldString") or args.get("find") or ""
    new_string = args.get("new_string") or args.get("newString") or args.get("replace_with") or args.get("content") or ""
    replace_all = bool(args.get("replace_all") or args.get("replaceAll"))

    # Validation
    if not old_string:
        return {"ok": False, "error": "old_string is required (the text to find)"}

    if mode in ("replace", "insert_before", "insert_after", "regex") and new_string == "" and mode != "delete":
        # For replace/insert modes, empty new_string is only valid if explicitly replacing with empty
        if "new_string" not in args and "newString" not in args and "replace_with" not in args and "content" not in args:
            if mode != "regex":  # regex can replace with empty
                return {"ok": False, "error": f"new_string is required for {mode} mode"}

    # Read existing file
    if not os.path.exists(p):
        return {"ok": False, "error": f"File not found: {p}"}

    try:
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception as e:
        return {"ok": False, "error": f"Failed to read file: {str(e)}"}

    original_content = content
    occurrences = 0

    if mode == "regex":
        # Regex-based find/replace
        try:
            pattern = re.compile(old_string)
            matches = pattern.findall(content)
            occurrences = len(matches)

            if occurrences == 0:
                return {
                    "ok": False,
                    "error": "no_match",
                    "message": f"Pattern not found in file: {old_string[:100]}{'...' if len(old_string) > 100 else ''}"
                }

            if replace_all:
                content = pattern.sub(new_string, content)
            else:
                content = pattern.sub(new_string, content, count=1)
                occurrences = 1

        except re.error as e:
            return {"ok": False, "error": f"Invalid regex pattern: {str(e)}"}

    else:
        # Plain text matching
        occurrences = content.count(old_string)

        if occurrences == 0:
            return {
                "ok": False,
                "error": "no_match",
                "message": f"String not found in file: {old_string[:100]}{'...' if len(old_string) > 100 else ''}"
            }

        if occurrences > 1 and not replace_all:
            # For safety, require unique match unless replace_all is set
            return {
                "ok": False,
                "error": "multiple_matches",
                "message": f"Found {occurrences} occurrences of the string. Set replace_all=true to replace all, or provide a more specific/unique string.",
                "occurrences": occurrences
            }

        if mode == "replace":
            if replace_all:
                content = content.replace(old_string, new_string)
            else:
                content = content.replace(old_string, new_string, 1)
                occurrences = 1

        elif mode == "insert_before":
            if replace_all:
                content = content.replace(old_string, new_string + old_string)
            else:
                content = content.replace(old_string, new_string + old_string, 1)
                occurrences = 1

        elif mode == "insert_after":
            if replace_all:
                content = content.replace(old_string, old_string + new_string)
            else:
                content = content.replace(old_string, old_string + new_string, 1)
                occurrences = 1

        elif mode == "delete":
            if replace_all:
                content = content.replace(old_string, "")
            else:
                content = content.replace(old_string, "", 1)
                occurrences = 1

    # Check if content actually changed
    if content == original_content:
        return {
            "ok": True,
            "mode": mode,
            "changes": 0,
            "message": "No changes made (content unchanged)"
        }

    # Checkpoint before writing
    CheckpointManager.record_change(p, "modify")

    # Write the modified content
    try:
        d = os.path.dirname(p)
        if d and not os.path.exists(d):
            os.makedirs(d, exist_ok=True)

        with open(p, "w", encoding="utf-8") as f:
            f.write(content)
    except Exception as e:
        return {"ok": False, "error": f"Failed to write file: {str(e)}"}

    return {
        "ok": True,
        "mode": mode,
        "changes": occurrences,
        "message": f"{mode.capitalize()} completed: {occurrences} occurrence(s) modified."
    }
