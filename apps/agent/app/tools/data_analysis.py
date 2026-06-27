"""Data Analysis tools — pandas/numpy/scipy + matplotlib/seaborn in an isolated venv.

The stack is heavy (~400MB across packages), so it is NOT in requirements.txt.
This module owns a dedicated venv `data_analysis` that is created on first
explicit setup (from the Connected Apps dashboard or the `data_analysis_setup`
tool). Subsequent calls reuse it.

Tool surface:

  Infra:
    data_analysis_status     — env + package status for the dashboard card
    data_analysis_setup      — create env, install required packages
    data_analysis_uninstall  — remove the env (frees disk)

  Data understanding:
    data_load                — peek at CSV/XLSX/JSON file: columns, dtypes, sample rows
    describe_data            — pandas describe()-style summary stats
    correlate_data           — correlation matrix (Pearson/Spearman)

  Visualization (one tool per chart type — focused, predictable):
    plot_line                — line chart, single or multi-series
    plot_bar                 — bar chart
    plot_scatter             — scatter plot
    plot_hist                — histogram
    plot_pie                 — pie chart
    plot_heatmap             — heatmap from 2D matrix
    plot_box                 — box plot

  Escape hatch:
    run_data_python          — arbitrary code in the env (pandas/numpy/matplotlib/seaborn/scipy)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional


_DA_ENV_ID = "data_analysis"
_REQUIRED_PACKAGES: List[str] = [
    "numpy",
    "pandas",
    "matplotlib",
    "seaborn",
    "scipy",
    "openpyxl",  # pandas needs this to read xlsx
]
_env_ready = False


def _get_output_dir() -> str:
    base = os.path.join(os.path.expanduser("~"), "StuardAI", "data_analysis")
    os.makedirs(base, exist_ok=True)
    return base


def _new_output_path(ext: str = "png") -> str:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    salt = hashlib.sha1(os.urandom(8)).hexdigest()[:6]
    return os.path.join(_get_output_dir(), f"{stamp}-{salt}.{ext}")


async def _packages_installed(py_bin: str) -> Dict[str, bool]:
    if not py_bin or not os.path.exists(py_bin):
        return {pkg: False for pkg in _REQUIRED_PACKAGES}
    code = (
        "import json, importlib.util as u; "
        f"print(json.dumps({{p: u.find_spec(p) is not None for p in {_REQUIRED_PACKAGES!r}}}))"
    )
    try:
        proc = await asyncio.to_thread(
            subprocess.run, [py_bin, "-c", code], capture_output=True, text=True, timeout=10
        )
        if proc.returncode != 0:
            return {pkg: False for pkg in _REQUIRED_PACKAGES}
        return json.loads(proc.stdout.strip())
    except Exception:
        return {pkg: False for pkg in _REQUIRED_PACKAGES}


async def _ensure_env(
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> tuple[str, str]:
    global _env_ready
    from . import system as _sys

    env_dir, py_bin = await _sys._ensure_python_env(_DA_ENV_ID, emit)

    if _env_ready:
        return env_dir, py_bin

    installed = await _packages_installed(py_bin)
    missing = [pkg for pkg in _REQUIRED_PACKAGES if not installed.get(pkg)]
    if not missing:
        _env_ready = True
        return env_dir, py_bin

    if emit:
        await emit("data_analysis_setup", {"status": "installing", "packages": missing})

    for pkg in missing:
        if emit:
            await emit("installing_package", {"package": pkg})
        proc = await asyncio.to_thread(
            subprocess.run,
            [py_bin, "-m", "pip", "install", "--quiet", pkg],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip()[:500]
            if emit:
                await emit("package_install_error", {"package": pkg, "error": err})
            raise RuntimeError(f"Failed to install {pkg}: {err}")
        if emit:
            await emit("package_installed", {"package": pkg})

    if emit:
        await emit("data_analysis_setup", {"status": "ready"})
    _env_ready = True
    return env_dir, py_bin


async def _run_in_env(
    py_bin: str,
    code: str,
    timeout_ms: int = 30000,
) -> Dict[str, Any]:
    """Execute Python in the data_analysis env (headless matplotlib backend)."""
    fd, tmp_path = tempfile.mkstemp(prefix="da-", suffix=".py")
    try:
        os.write(fd, code.encode("utf-8"))
        os.close(fd)
        env = os.environ.copy()
        env["MPLBACKEND"] = "Agg"
        proc = await asyncio.to_thread(
            subprocess.run,
            [py_bin, tmp_path],
            capture_output=True,
            text=True,
            timeout=max(1, timeout_ms / 1000),
            env=env,
        )
        return {
            "ok": proc.returncode == 0,
            "exitCode": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "exitCode": None, "stdout": "", "stderr": "timeout"}
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass


def _last_json_line(stdout: str) -> Dict[str, Any]:
    """Parse the last non-empty stdout line as JSON. Returns {} on failure."""
    for line in reversed((stdout or "").splitlines()):
        s = line.strip()
        if not s:
            continue
        try:
            return json.loads(s)
        except Exception:
            return {}
    return {}


# ───── Infra tools ───────────────────────────────────────────────────────────

async def data_analysis_status(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """Report whether the data_analysis env is installed and all required packages are present."""
    from . import system as _sys

    env_dir = _sys._python_env_dir(_DA_ENV_ID)
    py_bin = _sys._python_env_bin(env_dir) if os.path.exists(env_dir) else ""
    env_exists = os.path.exists(py_bin)

    installed = await _packages_installed(py_bin) if env_exists else {pkg: False for pkg in _REQUIRED_PACKAGES}
    all_ready = env_exists and all(installed.values())

    return {
        "ok": True,
        "installed": all_ready,
        "envExists": env_exists,
        "envPath": env_dir,
        "python": py_bin if env_exists else "",
        "packages": installed,
        "required": list(_REQUIRED_PACKAGES),
        "outputDir": _get_output_dir(),
    }


async def data_analysis_setup(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """Create the data_analysis venv and install required packages. Idempotent."""
    try:
        env_dir, py_bin = await _ensure_env(emit)
        return {
            "ok": True,
            "envPath": env_dir,
            "python": py_bin,
            "packages": list(_REQUIRED_PACKAGES),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def data_analysis_uninstall(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """Remove the data_analysis venv. Frees ~400MB."""
    global _env_ready
    from . import system as _sys

    env_dir = _sys._python_env_dir(_DA_ENV_ID)
    removed = False
    if os.path.exists(env_dir):
        try:
            await asyncio.to_thread(shutil.rmtree, env_dir, ignore_errors=False)
            removed = True
        except Exception as e:
            return {"ok": False, "error": str(e)}
    _env_ready = False
    return {"ok": True, "removed": removed, "envPath": env_dir}


# ───── Data understanding tools ──────────────────────────────────────────────

async def data_load(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """Peek at a data file: columns, dtypes, shape, and a sample of rows.

    Args:
        path: file path (.csv, .tsv, .xlsx, .xls, .json, .parquet)
        sheet: optional sheet name for xlsx
        sampleRows: how many rows to return (default 10)
    """
    args = args or {}
    path = str(args.get("path") or "").strip()
    if not path:
        return {"ok": False, "error": "missing_path"}
    if not os.path.exists(path):
        return {"ok": False, "error": f"file_not_found: {path}"}

    sheet = args.get("sheet")
    sample_rows = int(args.get("sampleRows") or 10)

    try:
        _, py_bin = await _ensure_env(emit)
    except Exception as e:
        return {"ok": False, "error": f"env_setup_failed: {e}"}

    code = (
        "import json, os, sys\n"
        "import pandas as pd\n"
        f"path = {json.dumps(path)}\n"
        f"sheet = {json.dumps(sheet)}\n"
        f"n = {sample_rows}\n"
        "ext = os.path.splitext(path)[1].lower()\n"
        "if ext == '.csv':\n"
        "    df = pd.read_csv(path)\n"
        "elif ext == '.tsv':\n"
        "    df = pd.read_csv(path, sep='\\t')\n"
        "elif ext in ('.xlsx', '.xls'):\n"
        "    df = pd.read_excel(path, sheet_name=sheet) if sheet else pd.read_excel(path)\n"
        "elif ext == '.json':\n"
        "    df = pd.read_json(path)\n"
        "elif ext == '.parquet':\n"
        "    df = pd.read_parquet(path)\n"
        "else:\n"
        "    raise ValueError(f'unsupported extension: {ext}')\n"
        "out = {\n"
        "  'rows': int(df.shape[0]),\n"
        "  'cols': int(df.shape[1]),\n"
        "  'columns': [str(c) for c in df.columns],\n"
        "  'dtypes': {str(c): str(df[c].dtype) for c in df.columns},\n"
        "  'sample': df.head(n).to_dict(orient='records'),\n"
        "  'nulls': {str(c): int(df[c].isna().sum()) for c in df.columns},\n"
        "}\n"
        "print(json.dumps(out, default=str))\n"
    )
    result = await _run_in_env(py_bin, code, timeout_ms=int(args.get("timeoutMs") or 30000))
    if not result["ok"]:
        return {"ok": False, "error": "load_failed", "stderr": result.get("stderr", "")[:1000]}
    out = _last_json_line(result.get("stdout") or "")
    return {"ok": True, "path": path, **out}


async def describe_data(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """Summary statistics (count, mean, std, min, quartiles, max) for numeric columns.

    Args:
        path: data file path (CSV/XLSX/JSON/Parquet) — OR pass `data` directly
        data: array of objects/rows (alternative to path)
        columns: optional subset of columns to describe
    """
    args = args or {}
    path = str(args.get("path") or "").strip()
    inline_data = args.get("data")
    columns = args.get("columns") or []
    if not path and inline_data is None:
        return {"ok": False, "error": "missing_path_or_data"}

    try:
        _, py_bin = await _ensure_env(emit)
    except Exception as e:
        return {"ok": False, "error": f"env_setup_failed: {e}"}

    code = (
        "import json, os\n"
        "import pandas as pd\n"
        f"path = {json.dumps(path)}\n"
        f"inline = {json.dumps(inline_data)}\n"
        f"cols = {json.dumps(columns)}\n"
        "if path:\n"
        "    ext = os.path.splitext(path)[1].lower()\n"
        "    if ext == '.csv': df = pd.read_csv(path)\n"
        "    elif ext == '.tsv': df = pd.read_csv(path, sep='\\t')\n"
        "    elif ext in ('.xlsx','.xls'): df = pd.read_excel(path)\n"
        "    elif ext == '.json': df = pd.read_json(path)\n"
        "    elif ext == '.parquet': df = pd.read_parquet(path)\n"
        "    else: raise ValueError(f'unsupported extension: {ext}')\n"
        "else:\n"
        "    df = pd.DataFrame(inline)\n"
        "if cols:\n"
        "    df = df[[c for c in cols if c in df.columns]]\n"
        "desc = df.describe(include='all').reset_index().rename(columns={'index':'stat'})\n"
        "out = {\n"
        "  'rows': int(df.shape[0]),\n"
        "  'cols': int(df.shape[1]),\n"
        "  'columns': [str(c) for c in df.columns],\n"
        "  'summary': desc.to_dict(orient='records'),\n"
        "}\n"
        "print(json.dumps(out, default=str))\n"
    )
    result = await _run_in_env(py_bin, code, timeout_ms=int(args.get("timeoutMs") or 30000))
    if not result["ok"]:
        return {"ok": False, "error": "describe_failed", "stderr": result.get("stderr", "")[:1000]}
    return {"ok": True, **_last_json_line(result.get("stdout") or "")}


async def correlate_data(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """Correlation matrix for numeric columns.

    Args:
        path or data: as in describe_data
        method: 'pearson' (default), 'spearman', or 'kendall'
        columns: optional subset
    """
    args = args or {}
    path = str(args.get("path") or "").strip()
    inline_data = args.get("data")
    columns = args.get("columns") or []
    method = str(args.get("method") or "pearson").lower()
    if method not in {"pearson", "spearman", "kendall"}:
        return {"ok": False, "error": f"unsupported_method: {method}"}
    if not path and inline_data is None:
        return {"ok": False, "error": "missing_path_or_data"}

    try:
        _, py_bin = await _ensure_env(emit)
    except Exception as e:
        return {"ok": False, "error": f"env_setup_failed: {e}"}

    code = (
        "import json, os\n"
        "import pandas as pd\n"
        f"path = {json.dumps(path)}\n"
        f"inline = {json.dumps(inline_data)}\n"
        f"cols = {json.dumps(columns)}\n"
        f"method = {json.dumps(method)}\n"
        "if path:\n"
        "    ext = os.path.splitext(path)[1].lower()\n"
        "    if ext == '.csv': df = pd.read_csv(path)\n"
        "    elif ext == '.tsv': df = pd.read_csv(path, sep='\\t')\n"
        "    elif ext in ('.xlsx','.xls'): df = pd.read_excel(path)\n"
        "    elif ext == '.json': df = pd.read_json(path)\n"
        "    elif ext == '.parquet': df = pd.read_parquet(path)\n"
        "    else: raise ValueError(f'unsupported extension: {ext}')\n"
        "else:\n"
        "    df = pd.DataFrame(inline)\n"
        "df = df.select_dtypes(include='number')\n"
        "if cols:\n"
        "    df = df[[c for c in cols if c in df.columns]]\n"
        "corr = df.corr(method=method).round(4)\n"
        "out = {\n"
        "  'method': method,\n"
        "  'columns': [str(c) for c in corr.columns],\n"
        "  'matrix': corr.values.tolist(),\n"
        "}\n"
        "print(json.dumps(out, default=str))\n"
    )
    result = await _run_in_env(py_bin, code, timeout_ms=int(args.get("timeoutMs") or 30000))
    if not result["ok"]:
        return {"ok": False, "error": "correlate_failed", "stderr": result.get("stderr", "")[:1000]}
    return {"ok": True, **_last_json_line(result.get("stdout") or "")}


# ───── Visualization tools (one per chart type) ──────────────────────────────

_PLOT_HEAD = (
    "import json, os\n"
    "import matplotlib\n"
    "matplotlib.use('Agg')\n"
    "import matplotlib.pyplot as plt\n"
    "import numpy as np\n"
    "import seaborn as sns\n"
    "sns.set_theme(style='whitegrid')\n"
)


def _plot_tail(save_path: str) -> str:
    return (
        f"save_path = {json.dumps(save_path)}\n"
        "os.makedirs(os.path.dirname(save_path), exist_ok=True)\n"
        "fig.tight_layout()\n"
        "fig.savefig(save_path, dpi=120, bbox_inches='tight')\n"
        "plt.close(fig)\n"
        "print(json.dumps({'path': save_path, 'width': fig.get_size_inches()[0]*120, 'height': fig.get_size_inches()[1]*120}))\n"
    )


def _resolve_save_path(args: Dict[str, Any]) -> str:
    return str(args.get("savePath") or "").strip() or _new_output_path("png")


def _figure_init(args: Dict[str, Any]) -> str:
    w = float(args.get("width") or 8)
    h = float(args.get("height") or 5)
    return f"fig, ax = plt.subplots(figsize=({w}, {h}), dpi=120)\n"


def _labels(args: Dict[str, Any]) -> str:
    title = args.get("title") or ""
    xl = args.get("xLabel") or ""
    yl = args.get("yLabel") or ""
    return (
        f"ax.set_title({json.dumps(title)}) if {json.dumps(bool(title))} else None\n"
        f"ax.set_xlabel({json.dumps(xl)}) if {json.dumps(bool(xl))} else None\n"
        f"ax.set_ylabel({json.dumps(yl)}) if {json.dumps(bool(yl))} else None\n"
    )


async def _run_plot(args: Dict[str, Any], body: str, emit, chart_type: str) -> Dict[str, Any]:
    save_path = _resolve_save_path(args)
    try:
        _, py_bin = await _ensure_env(emit)
    except Exception as e:
        return {"ok": False, "error": f"env_setup_failed: {e}"}
    code = _PLOT_HEAD + _figure_init(args) + body + _labels(args) + _plot_tail(save_path)
    result = await _run_in_env(py_bin, code, timeout_ms=int(args.get("timeoutMs") or 30000))
    if not result["ok"]:
        return {"ok": False, "error": "plot_failed", "stderr": (result.get("stderr") or "")[:2000]}
    out = _last_json_line(result.get("stdout") or "")
    return {"ok": True, "path": out.get("path") or save_path, "width": out.get("width"), "height": out.get("height"), "type": chart_type}


async def plot_line(args: Dict[str, Any], emit=None) -> Dict[str, Any]:
    """Line chart.

    Args:
        data: number[] for a single series
        series: [{name, data: number[] OR [{x,y}, ...], marker?}, ...] for multi-series
        title, xLabel, yLabel, width, height, savePath
        grid: bool (default true)
    """
    args = args or {}
    series = args.get("series")
    if series is None:
        series = [{"name": args.get("name") or "series", "data": args.get("data") or []}]
    body = (
        f"series = {json.dumps(series)}\n"
        "for s in series:\n"
        "    d = s.get('data') or []\n"
        "    if d and isinstance(d[0], dict):\n"
        "        xs = [p.get('x') for p in d]; ys = [p.get('y') for p in d]\n"
        "    else:\n"
        "        xs = list(range(len(d))); ys = d\n"
        "    ax.plot(xs, ys, label=s.get('name'), marker=s.get('marker') or 'o', linewidth=2)\n"
        "if any(s.get('name') for s in series): ax.legend()\n"
        f"ax.grid({json.dumps(bool(args.get('grid', True)))}, alpha=0.3)\n"
    )
    return await _run_plot(args, body, emit, "line")


async def plot_bar(args: Dict[str, Any], emit=None) -> Dict[str, Any]:
    """Bar chart.

    Args:
        data: number[] OR [{label,value}, ...]
        labels: string[] (if data is number[])
        color: hex string
        rotation: x-tick rotation in degrees (default 0)
        horizontal: bool (default false)
    """
    args = args or {}
    data = args.get("data") or []
    body = (
        f"data = {json.dumps(data)}\n"
        f"labels = {json.dumps(args.get('labels'))}\n"
        "if data and isinstance(data[0], dict):\n"
        "    labels = labels or [str(p.get('label')) for p in data]\n"
        "    values = [p.get('value') for p in data]\n"
        "else:\n"
        "    labels = labels or [str(i) for i in range(len(data))]\n"
        "    values = data\n"
        f"horizontal = {json.dumps(bool(args.get('horizontal', False)))}\n"
        f"color = {json.dumps(args.get('color') or '#4f46e5')}\n"
        "if horizontal:\n"
        "    ax.barh(labels, values, color=color)\n"
        "else:\n"
        f"    ax.bar(labels, values, color=color)\n"
        f"    rot = {int(args.get('rotation') or 0)}\n"
        "    if rot: plt.setp(ax.get_xticklabels(), rotation=rot, ha='right')\n"
    )
    return await _run_plot(args, body, emit, "bar")


async def plot_scatter(args: Dict[str, Any], emit=None) -> Dict[str, Any]:
    """Scatter plot.

    Args:
        data: [{x, y, size?, color?}, ...]
        color: default marker color
        regression: bool — overlay a linear regression line (default false)
    """
    args = args or {}
    data = args.get("data") or []
    body = (
        f"data = {json.dumps(data)}\n"
        "xs = [p.get('x') for p in data]\n"
        "ys = [p.get('y') for p in data]\n"
        "sizes = [p.get('size') or 40 for p in data]\n"
        f"default_color = {json.dumps(args.get('color') or '#0ea5e9')}\n"
        "colors = [p.get('color') or default_color for p in data]\n"
        "ax.scatter(xs, ys, s=sizes, c=colors, alpha=0.7)\n"
        f"if {json.dumps(bool(args.get('regression', False)))} and len(xs) >= 2:\n"
        "    xa = np.array(xs); ya = np.array(ys)\n"
        "    m, b = np.polyfit(xa, ya, 1)\n"
        "    xline = np.linspace(xa.min(), xa.max(), 100)\n"
        "    ax.plot(xline, m*xline + b, color='#ef4444', linewidth=1.5, alpha=0.8, label=f'y = {m:.2f}x + {b:.2f}')\n"
        "    ax.legend()\n"
        f"ax.grid({json.dumps(bool(args.get('grid', True)))}, alpha=0.3)\n"
    )
    return await _run_plot(args, body, emit, "scatter")


async def plot_hist(args: Dict[str, Any], emit=None) -> Dict[str, Any]:
    """Histogram.

    Args:
        data: number[]
        bins: int (default 20)
        color: hex string
        kde: bool — overlay a KDE curve via seaborn (default false)
    """
    args = args or {}
    body = (
        f"data = {json.dumps(args.get('data') or [])}\n"
        f"bins = {int(args.get('bins') or 20)}\n"
        f"color = {json.dumps(args.get('color') or '#16a34a')}\n"
        f"kde = {json.dumps(bool(args.get('kde', False)))}\n"
        "if kde:\n"
        "    sns.histplot(data, bins=bins, kde=True, color=color, edgecolor='white', ax=ax)\n"
        "else:\n"
        "    ax.hist(data, bins=bins, color=color, edgecolor='white')\n"
        f"ax.grid({json.dumps(bool(args.get('grid', True)))}, alpha=0.3, axis='y')\n"
    )
    return await _run_plot(args, body, emit, "hist")


async def plot_pie(args: Dict[str, Any], emit=None) -> Dict[str, Any]:
    """Pie chart.

    Args:
        data: number[] OR [{label,value}, ...]
        labels: string[] (if data is number[])
        donut: bool — render as a donut chart (default false)
    """
    args = args or {}
    data = args.get("data") or []
    body = (
        f"data = {json.dumps(data)}\n"
        f"labels = {json.dumps(args.get('labels'))}\n"
        "if data and isinstance(data[0], dict):\n"
        "    labels = labels or [str(p.get('label')) for p in data]\n"
        "    values = [p.get('value') for p in data]\n"
        "else:\n"
        "    labels = labels or [str(i) for i in range(len(data))]\n"
        "    values = data\n"
        f"donut = {json.dumps(bool(args.get('donut', False)))}\n"
        "wedge_props = {'width': 0.45} if donut else None\n"
        "ax.pie(values, labels=labels, autopct='%1.1f%%', startangle=90, wedgeprops=wedge_props)\n"
        "ax.axis('equal')\n"
    )
    return await _run_plot(args, body, emit, "pie")


async def plot_heatmap(args: Dict[str, Any], emit=None) -> Dict[str, Any]:
    """Heatmap from a 2D matrix.

    Args:
        data: number[][] (2D matrix)
        xTicks, yTicks: optional label arrays
        cmap: matplotlib colormap name (default 'viridis')
        annot: bool — write values into cells (default false)
    """
    args = args or {}
    body = (
        f"data = {json.dumps(args.get('data') or [])}\n"
        f"x_ticks = {json.dumps(args.get('xTicks'))}\n"
        f"y_ticks = {json.dumps(args.get('yTicks'))}\n"
        f"cmap = {json.dumps(args.get('cmap') or 'viridis')}\n"
        f"annot = {json.dumps(bool(args.get('annot', False)))}\n"
        "arr = np.array(data)\n"
        "sns.heatmap(arr, xticklabels=x_ticks if x_ticks else 'auto', yticklabels=y_ticks if y_ticks else 'auto', cmap=cmap, annot=annot, fmt='.2f' if annot else '', ax=ax)\n"
    )
    return await _run_plot(args, body, emit, "heatmap")


async def plot_box(args: Dict[str, Any], emit=None) -> Dict[str, Any]:
    """Box plot.

    Args:
        data: number[] for one box, OR [{label, values: number[]}, ...] for grouped boxes
        notch: bool — draw notched boxes (default false)
    """
    args = args or {}
    data = args.get("data") or []
    body = (
        f"data = {json.dumps(data)}\n"
        f"notch = {json.dumps(bool(args.get('notch', False)))}\n"
        "if data and isinstance(data[0], dict):\n"
        "    labels = [str(g.get('label')) for g in data]\n"
        "    values = [g.get('values') or [] for g in data]\n"
        "    ax.boxplot(values, labels=labels, notch=notch, patch_artist=True)\n"
        "else:\n"
        "    ax.boxplot(data, notch=notch, patch_artist=True)\n"
        f"ax.grid({json.dumps(bool(args.get('grid', True)))}, alpha=0.3, axis='y')\n"
    )
    return await _run_plot(args, body, emit, "box")


# ───── Escape hatch ──────────────────────────────────────────────────────────

async def run_data_python(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Dict[str, Any] | None], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """Run arbitrary Python in the data_analysis env.

    pandas, numpy, scipy, matplotlib, seaborn are pre-imported as pd, np, sp, plt, sns
    (you can rebind if you want). Matplotlib uses the headless Agg backend.

    If your script produces a figure, save it to ``output_path`` (auto-generated and pre-set
    in scope) and the path will be returned via outputPath in the result.

    Args:
        code: Python source
        outputPath: suggested save path (auto-generated if omitted)
        timeoutMs: execution timeout (default 30000)
    """
    args = args or {}
    code = str(args.get("code") or "").strip()
    if not code:
        return {"ok": False, "error": "missing_code"}

    save_path = str(args.get("outputPath") or "").strip() or _new_output_path("png")
    timeout_ms = int(args.get("timeoutMs") or 30000)

    try:
        _, py_bin = await _ensure_env(emit)
    except Exception as e:
        return {"ok": False, "error": f"env_setup_failed: {e}"}

    prelude = (
        "import os, sys, json\n"
        "import matplotlib\n"
        "matplotlib.use('Agg')\n"
        "import matplotlib.pyplot as plt\n"
        "import numpy as np\n"
        "import pandas as pd\n"
        "import seaborn as sns\n"
        "import scipy as sp\n"
        f"output_path = {json.dumps(save_path)}\n"
        "os.makedirs(os.path.dirname(output_path), exist_ok=True)\n"
    )
    full_code = prelude + "\n" + code

    result = await _run_in_env(py_bin, full_code, timeout_ms=timeout_ms)
    saved = os.path.exists(save_path)
    return {
        "ok": bool(result["ok"]),
        "exitCode": result.get("exitCode"),
        "stdout": (result.get("stdout") or "")[:8000],
        "stderr": (result.get("stderr") or "")[:4000],
        "outputPath": save_path if saved else None,
    }
