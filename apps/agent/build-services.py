#!/usr/bin/env python3
"""
Unified build script for all Stuard AI service executables.

Builds one or more services into standalone executables using PyInstaller:
  - agent      : The main AI agent (FastAPI server)
  - browser    : Browser automation server (Playwright + aiohttp)
  - mediapipe  : MediaPipe vision service (aiohttp + mediapipe)

Usage:
  python build-services.py                    # Build all services
  python build-services.py --services agent browser  # Build specific ones
  python build-services.py --services browser # Just the browser server
  python build-services.py --parallel         # Build all in parallel (faster CI)
  python build-services.py --skip-mediapipe   # Skip mediapipe (not always needed)

Output goes to ../../dist/ for the desktop app's prepare-agent script to pick up.
"""

import argparse
import subprocess
import sys
import os
import shutil
import platform
import time
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed


# ---------------------------------------------------------------------------
# Service definitions
# ---------------------------------------------------------------------------

SERVICES = {
    "agent": {
        "spec": "stuard-agent.spec",
        "description": "Main AI Agent (FastAPI)",
        "exe_win": "stuard-agent.exe",
        "exe_mac": "stuard-agent-macos",
        "exe_linux": "stuard-agent-linux",
        "requirements": "requirements.txt",
    },
    "browser": {
        "spec": "stuard-browser.spec",
        "description": "Browser Automation Server",
        "exe_win": "stuard-browser.exe",
        "exe_mac": "stuard-browser-macos",
        "exe_linux": "stuard-browser-linux",
        "requirements": None,  # uses same env as agent; only needs playwright + aiohttp
    },
    "mediapipe": {
        "spec": "stuard-mediapipe.spec",
        "description": "MediaPipe Vision Service",
        "exe_win": "stuard-mediapipe.exe",
        "exe_mac": "stuard-mediapipe-macos",
        "exe_linux": "stuard-mediapipe-linux",
        "requirements": None,  # needs mediapipe + opencv + numpy
    },
}


def get_exe_name(service: dict) -> str:
    if sys.platform == "win32":
        return service["exe_win"]
    elif sys.platform == "darwin":
        return service["exe_mac"]
    else:
        return service["exe_linux"]


def clean_directory(path: Path):
    if path.exists():
        try:
            shutil.rmtree(path)
            print(f"  Cleaned: {path}")
        except Exception as e:
            print(f"  Warning: Could not clean {path}: {e}")


def build_service(name: str, agent_dir: Path, dist_dir: Path) -> tuple[str, bool, str]:
    """Build a single service. Returns (name, success, message)."""
    svc = SERVICES[name]
    spec_file = agent_dir / svc["spec"]

    if not spec_file.exists():
        return name, False, f"Spec file not found: {spec_file}"

    print(f"\n{'='*60}")
    print(f"  Building: {svc['description']} ({name})")
    print(f"  Spec:     {spec_file.name}")
    print(f"{'='*60}\n")

    start = time.time()

    # Run PyInstaller
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--log-level", "WARN",
        "--distpath", str(agent_dir / "dist"),
        "--workpath", str(agent_dir / "build" / name),
        str(spec_file),
    ]

    result = subprocess.run(cmd, cwd=agent_dir)

    if result.returncode != 0:
        return name, False, f"PyInstaller failed with exit code {result.returncode}"

    # Find and copy the built executable
    exe_name = get_exe_name(svc)
    src_exe = agent_dir / "dist" / exe_name
    dest_exe = dist_dir / exe_name

    if not src_exe.exists():
        # List what was actually created
        local_dist = agent_dir / "dist"
        contents = []
        if local_dist.exists():
            for f in local_dist.iterdir():
                if f.is_file():
                    contents.append(f"{f.name} ({f.stat().st_size / (1024*1024):.1f} MB)")
                else:
                    contents.append(f"{f.name}/ (dir)")
        return name, False, f"Expected {exe_name} not found. dist/ contains: {', '.join(contents)}"

    # Copy to monorepo dist/
    if dest_exe.exists():
        dest_exe.unlink()
    shutil.copy2(str(src_exe), str(dest_exe))

    # Make executable on Unix
    if sys.platform != "win32":
        os.chmod(dest_exe, 0o755)

    elapsed = time.time() - start
    size_mb = dest_exe.stat().st_size / (1024 * 1024)
    return name, True, f"Built {exe_name} ({size_mb:.1f} MB) in {elapsed:.0f}s"


def print_build_header(services_to_build: list[str], parallel: bool, dist_dir: Path):
    divider = "=" * 60
    print(divider)
    print("Stuard AI Service Builder")
    print(divider)
    print(f"Platform : {platform.system()} {platform.machine()}")
    print(f"Python   : {sys.version.split()[0]}")
    print(f"Services : {', '.join(services_to_build)}")
    print(f"Parallel : {'Yes' if parallel else 'No'}")
    print(f"Output   : {dist_dir}")
    print(divider)


def main():
    parser = argparse.ArgumentParser(description="Build Stuard AI service executables")
    parser.add_argument(
        "--services",
        nargs="+",
        choices=list(SERVICES.keys()),
        default=None,
        help="Services to build (default: all)",
    )
    parser.add_argument(
        "--parallel",
        action="store_true",
        help="Build services in parallel (faster for CI)",
    )
    parser.add_argument(
        "--skip-mediapipe",
        action="store_true",
        help="Skip the mediapipe service (saves time if not needed)",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Clean build caches before building",
    )
    args = parser.parse_args()

    agent_dir = Path(__file__).parent.absolute()
    os.chdir(agent_dir)

    dist_dir = agent_dir.parent.parent / "dist"
    dist_dir.mkdir(exist_ok=True)

    # Determine which services to build
    services_to_build = args.services or list(SERVICES.keys())
    if args.skip_mediapipe and "mediapipe" in services_to_build:
        services_to_build.remove("mediapipe")

    print_build_header(services_to_build, args.parallel, dist_dir)

    if args.clean:
        print("\nCleaning build caches...")
        clean_directory(agent_dir / "dist")
        clean_directory(agent_dir / "build")

    total_start = time.time()
    results = []

    if args.parallel and len(services_to_build) > 1:
        # Parallel builds (useful in CI with multi-core runners)
        with ProcessPoolExecutor(max_workers=min(len(services_to_build), 3)) as pool:
            futures = {
                pool.submit(build_service, name, agent_dir, dist_dir): name
                for name in services_to_build
            }
            for future in as_completed(futures):
                name = futures[future]
                try:
                    results.append(future.result())
                except Exception as e:
                    results.append((name, False, f"Build crashed: {e}"))
    else:
        # Sequential builds
        for name in services_to_build:
            results.append(build_service(name, agent_dir, dist_dir))

    # Summary
    total_elapsed = time.time() - total_start
    print(f"\n{'='*60}")
    print(f"  BUILD SUMMARY ({total_elapsed:.0f}s total)")
    print(f"{'='*60}")

    all_ok = True
    for name, success, message in results:
        icon = "OK" if success else "FAIL"
        print(f"  [{icon}] {name}: {message}")
        if not success:
            all_ok = False

    print()
    if all_ok:
        print(f"All {len(results)} service(s) built successfully.")
        print(f"Binaries are in: {dist_dir}")
    else:
        failed = [name for name, success, _ in results if not success]
        print(f"FAILED: {', '.join(failed)}")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[build-services] Build cancelled")
        sys.exit(130)
    except Exception as e:
        print(f"\n[build-services] FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
