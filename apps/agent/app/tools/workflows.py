
import json
import os
import re
import sys
import zipfile
from datetime import datetime
from typing import Any, Dict, List


APP_NAME = "Stuard AI"
APP_NAME_DEV = "@stuardai/desktop"


def _user_data_dir() -> str:
    """Best-effort reconstruction of Electron's app.getPath('userData') for Stuard.

    In packaged builds, Electron uses the productName ("Stuard AI").
    In dev, Electron typically uses the package.json name ("@stuardai/desktop").

    This helper prefers any directory that already contains "workflows" or
    "stuards" folders, so listing works in both dev and packaged modes.
    """
    plat = sys.platform
    if plat.startswith("win"):
        base = os.environ.get("APPDATA") or os.path.expanduser("~\\AppData\\Roaming")
    elif plat == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        # Linux / other UNIX
        base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")

    candidates = [APP_NAME, APP_NAME_DEV]

    # Prefer an existing directory that already has workflows or stuards
    for name in candidates:
        try:
            root = os.path.join(base, name)
            wf_dir = os.path.join(root, "workflows")
            st_dir = os.path.join(root, "stuards")
            if os.path.isdir(wf_dir) or os.path.isdir(st_dir):
                return root
        except Exception:
            continue

    # Fallback to primary app name
    return os.path.join(base, APP_NAME)


def _workflows_dir() -> str:
    return os.path.join(_user_data_dir(), "workflows")


def _stuards_dir() -> str:
    return os.path.join(_user_data_dir(), "stuards")


def _safe_id(s: str) -> str:
    return re.sub(r'[^a-zA-Z0-9_-]', '', s)


def _extract_input_metadata(data: Dict[str, Any]) -> Dict[str, Any]:
    meta: Dict[str, Any] = {}
    if not isinstance(data, dict):
        return meta
    input_example = data.get("inputExample")
    if input_example is not None:
        meta["inputExample"] = input_example

    keys: set[str] = set()

    def collect_from_value(value: Any) -> None:
        if isinstance(value, str):
            for m in re.finditer(r"\{\{\s*input\.([^}]+)\}\}", value):
                key = m.group(1).strip()
                if key:
                    keys.add(key)
        elif isinstance(value, dict):
            for v in value.values():
                collect_from_value(v)
        elif isinstance(value, list):
            for v in value:
                collect_from_value(v)

    steps = data.get("steps")
    if isinstance(steps, list):
        for step in steps:
            if not isinstance(step, dict):
                continue
            args = step.get("args")
            if args is not None:
                collect_from_value(args)
            with_args = step.get("with")
            if with_args is not None:
                collect_from_value(with_args)
            next_list = step.get("next")
            if isinstance(next_list, list):
                for edge in next_list:
                    if not isinstance(edge, dict):
                        continue
                    guard = edge.get("guard")

                    def collect_from_guard(gv: Any) -> None:
                        if isinstance(gv, dict):
                            for k, v in gv.items():
                                if k == "var" and isinstance(v, str) and v.startswith("input."):
                                    keys.add(v)
                                else:
                                    collect_from_guard(v)
                        elif isinstance(gv, list):
                            for vv in gv:
                                collect_from_guard(vv)

                    collect_from_guard(guard)

    if keys:
        meta["inputKeys"] = sorted(keys)
    return meta


def _list_json_items(dir_path: str) -> List[Dict[str, Any]]:
    print(f"[PYTHON AGENT] _list_json_items called with: {dir_path}")
    items: List[Dict[str, Any]] = []
    try:
        if not os.path.isdir(dir_path):
            print(f"[PYTHON AGENT] dir does not exist: {dir_path}")
            return items
        for name in os.listdir(dir_path):
            if not name.lower().endswith(".json"):
                continue
            full = os.path.join(dir_path, name)
            if not os.path.isfile(full):
                continue
            item_id = os.path.splitext(name)[0]
            meta: Dict[str, Any] = {"id": item_id}
            try:
                stat = os.stat(full)
                meta["updatedAt"] = stat.st_mtime
            except Exception:
                pass
            try:
                with open(full, "r", encoding="utf-8", errors="replace") as f:
                    raw = f.read()
                data = json.loads(raw or "{}")
                if isinstance(data, dict):
                    nm = str(data.get("name") or "").strip()
                    if nm:
                        meta["name"] = nm
                    desc = str(data.get("description") or "").strip()
                    if desc:
                        meta["description"] = desc
                    triggers = []
                    if isinstance(data.get("triggers"), list):
                        for t in data["triggers"]:
                            try:
                                typ = str((t or {}).get("type") or "").strip()
                                if typ:
                                    triggers.append(typ)
                            except Exception:
                                continue
                    if triggers:
                        meta["triggers"] = triggers
                    if isinstance(data.get("autostart"), bool):
                        meta["autostart"] = bool(data["autostart"])
                    extra = _extract_input_metadata(data)
                    if extra:
                        meta.update(extra)
            except Exception:
                pass
            items.append(meta)
    except Exception:
        return items
    return items


def _workflow_score(item: Dict[str, Any], query: str) -> int:
    q = (query or "").strip().lower()
    if not q:
        return 0
    item_id = str(item.get("id") or "").lower()
    name = str(item.get("name") or "").lower()
    desc = str(item.get("description") or "").lower()
    triggers = " ".join(str(t) for t in item.get("triggers") or []).lower()
    haystack = f"{item_id} {name} {desc} {triggers}"
    tokens = [t for t in re.split(r"\s+", q) if t]

    score = 0
    if item_id == q or name == q:
        score += 100
    if item_id.startswith(q) or name.startswith(q):
        score += 60
    if item_id.find(q) >= 0 or name.find(q) >= 0:
        score += 40
    if desc.find(q) >= 0:
        score += 25
    for token in tokens:
        if token in name:
            score += 12
        if token in desc:
            score += 8
        if token in haystack:
            score += 4
    return score


async def search_local_workflows(args: Dict[str, Any]) -> Dict[str, Any]:
    """Search local workflow JSON files created by the Stuard desktop app."""
    query = str(args.get("query") or "").strip()
    limit = max(1, min(250, int(args.get("limit") or 10)))
    requested_mode = str(args.get("mode") or "lexical").lower()
    items = _list_json_items(_workflows_dir())
    workflows: List[Dict[str, Any]] = []
    for item in items:
        scored = dict(item)
        scored["description"] = str(scored.get("description") or "")
        scored["triggers"] = scored.get("triggers") if isinstance(scored.get("triggers"), list) else []
        scored["inputSchema"] = []
        scored["outputSchema"] = []
        scored["score"] = _workflow_score(scored, query)
        workflows.append(scored)

    if query:
        workflows = [w for w in workflows if int(w.get("score") or 0) > 0]
    workflows.sort(key=lambda w: (int(w.get("score") or 0), float(w.get("updatedAt") or 0)), reverse=True)
    return {
        "ok": True,
        "workflows": workflows[:limit],
        "mode": "lexical",
        "requestedMode": requested_mode,
    }


async def list_local_stuards(args: Dict[str, Any]) -> Dict[str, Any]:
    """List local Stuard specs (automations) created by the Stuard desktop app."""
    items = _list_json_items(_stuards_dir())
    return {"ok": True, "items": items}


async def stuards_import_workflow(args: Dict[str, Any]) -> Dict[str, Any]:
    """Import a WorkflowDefinition via desktop IPC stuards:importWorkflow handler."""
    try:
        return {
            "ok": False,
            "error": "stuards_import_workflow must be called via desktop IPC bridge"
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def stuards_run(args: Dict[str, Any]) -> Dict[str, Any]:
    """Run a Stuard automation via desktop IPC stuards:run handler."""
    try:
        return {
            "ok": False,
            "error": "stuards_run must be called via desktop IPC bridge"
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def stuards_stop(args: Dict[str, Any]) -> Dict[str, Any]:
    """Stop a Stuard automation via desktop IPC stuards:stop handler."""
    try:
        return {
            "ok": False,
            "error": "stuards_stop must be called via desktop IPC bridge"
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def invoke_workflow(args: Dict[str, Any]) -> Dict[str, Any]:
    """Invoke a workflow with optional arguments. Arguments are passed to the workflow as ctx.args."""
    try:
        return {
            "ok": False,
            "error": "invoke_workflow must be called via desktop IPC bridge"
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}



async def test_run_steps(args: Dict[str, Any]) -> Dict[str, Any]:
    """Test run workflow steps without saving. Returns execution logs and results."""
    try:
        return {
            "ok": False,
            "error": "test_run_steps must be called via desktop IPC bridge"
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def show_json_workflow_code(args: Dict[str, Any], emit=None) -> Dict[str, Any]:
    """Return the full Stuard workflow JSON by id and display it."""
    wf_id = str(args.get("id") or "").strip()
    if not wf_id:
        return {"ok": False, "error": "missing_id"}

    wf_dir = _workflows_dir()
    path_val = os.path.join(wf_dir, f"{wf_id}.json")
    
    # Check if it exists
    if not os.path.isfile(path_val):
        # Fallback to stuards dir?
        st_dir = _stuards_dir()
        path_val_st = os.path.join(st_dir, f"{wf_id}.json")
        if os.path.isfile(path_val_st):
            path_val = path_val_st
        else:
            return {"ok": False, "error": "workflow_not_found"}

    try:
        with open(path_val, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        # Note: JSON display is handled by the TypeScript wrapper in cloud-ai
        # which automatically calls show_json after this tool completes
        
        return {"ok": True, "workflow": data, "filePath": path_val}
    except Exception as e:
        return {"ok": False, "error": str(e)}



async def export_workflow(args: Dict[str, Any]) -> Dict[str, Any]:
    """Export a workflow to a .stuard bundle (zip)."""
    try:
        wf_id = str(args.get("id") or "").strip()
        if not wf_id:
            return {"ok": False, "error": "missing_id"}
        
        # Find the file
        wf_dir = _workflows_dir()
        src = os.path.join(wf_dir, f"{wf_id}.json")
        if not os.path.isfile(src):
            return {"ok": False, "error": "workflow_not_found"}
            
        # Read content
        with open(src, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        # Create export dir if needed
        export_dir = os.path.join(os.path.expanduser("~"), "Documents", "Stuard", "Exports")
        try:
            os.makedirs(export_dir, exist_ok=True)
        except Exception:
            # fallback to temp
            export_dir = os.path.join(os.environ.get("TEMP") or "/tmp", "StuardExports")
            os.makedirs(export_dir, exist_ok=True)
        
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        name = _safe_id(data.get("name") or "workflow")
        out_name = f"{name}_{ts}.stuard"
        out_path = os.path.join(export_dir, out_name)
        
        # create zip
        with zipfile.ZipFile(out_path, 'w') as z:
            # workflow.json
            z.writestr("workflow.json", json.dumps(data, indent=2))
            
            # requirements.txt
            reqs = data.get("requirements", "")
            if reqs:
                z.writestr("requirements.txt", reqs)
                
            # scripts
            scripts = data.get("scripts", {})
            if isinstance(scripts, dict):
                for sname, scontent in scripts.items():
                    z.writestr(f"scripts/{sname}", str(scontent))
                
        return {"ok": True, "path": out_path}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def import_workflow(args: Dict[str, Any]) -> Dict[str, Any]:
    """Import a workflow from a .json or .stuard file, or a raw definition object."""
    try:
        definition = args.get("definition")
        if definition and isinstance(definition, dict):
            # Import from direct definition
            data = definition
        else:
            # Import from path
            path_val = str(args.get("path") or "").strip()
            if not path_val or not os.path.isfile(path_val):
                return {"ok": False, "error": "invalid_path"}
            
            data = {}
            
            # Check extension or try zip
            is_zip = path_val.lower().endswith(".zip") or path_val.lower().endswith(".stuard")
            if not is_zip:
                # Try to open as zip anyway to be safe
                if zipfile.is_zipfile(path_val):
                    is_zip = True
            
            if is_zip:
                with zipfile.ZipFile(path_val, 'r') as z:
                    # Try to read workflow.json
                    try:
                        with z.open("workflow.json") as f:
                            data = json.load(f)
                    except KeyError:
                        return {"ok": False, "error": "invalid_bundle_no_workflow_json"}
                    
                    # Read requirements
                    try:
                        with z.open("requirements.txt") as f:
                            data["requirements"] = f.read().decode("utf-8")
                    except KeyError:
                        pass
                        
                    # Read scripts
                    scripts = {}
                    for n in z.namelist():
                        if n.startswith("scripts/") and not n.endswith("/"):
                            sname = os.path.basename(n)
                            if sname:
                                with z.open(n) as f:
                                    scripts[sname] = f.read().decode("utf-8")
                    if scripts:
                        data["scripts"] = scripts
            else:
                # Assume JSON
                with open(path_val, "r", encoding="utf-8") as f:
                    data = json.load(f)
                
        # Save as new workflow
        # If ID is present in definition, prefer it, otherwise gen new one?
        # Usually import implies new ID to avoid collision, but if we are creating, we might want to keep ID.
        # create_workflow generates an ID.
        
        wf_id = data.get("id")
        if not wf_id:
            wf_id = "flow_" + datetime.now().strftime("%Y%m%d%H%M%S") + "_" + os.urandom(2).hex()
            data["id"] = wf_id
        
        wf_dir = _workflows_dir()
        os.makedirs(wf_dir, exist_ok=True)
        dest = os.path.join(wf_dir, f"{wf_id}.json")
        
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            
        return {"ok": True, "id": wf_id}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def validate_workflow_requirements(args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        wf_id = str(args.get("id") or "").strip()
        if not wf_id:
            return {"ok": False, "error": "missing_id"}
            
        wf_dir = _workflows_dir()
        src = os.path.join(wf_dir, f"{wf_id}.json")
        if not os.path.isfile(src):
            return {"ok": False, "error": "workflow_not_found"}
            
        with open(src, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        reqs_str = data.get("requirements", "")
        reqs_list = [r.strip() for r in reqs_str.split('\n') if r.strip() and not r.strip().startswith('#')]
        
        return {"ok": True, "requirements": reqs_list}
    except Exception as e:
        return {"ok": False, "error": str(e)}
