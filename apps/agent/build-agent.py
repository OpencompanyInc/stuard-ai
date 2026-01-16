#!/usr/bin/env python3
"""
Build script for Stuard AI Agent.
Compiles the FastAPI agent into a standalone executable using PyInstaller.
Output goes to ../../dist/ for the desktop app's prepare-agent script.

Cross-platform: Windows, macOS, Linux
"""

import subprocess
import sys
import os
import shutil
import platform
from pathlib import Path


def get_platform_info():
    """Get platform details for logging."""
    return {
        "system": platform.system(),
        "release": platform.release(),
        "machine": platform.machine(),
        "python": sys.version,
    }


def clean_directory(path: Path):
    """Safely remove a directory."""
    if path.exists():
        try:
            shutil.rmtree(path)
            print(f"[build-agent] Cleaned: {path}")
        except Exception as e:
            print(f"[build-agent] Warning: Could not clean {path}: {e}")


def main():
    # Ensure we're in the agent directory
    agent_dir = Path(__file__).parent.absolute()
    os.chdir(agent_dir)
    
    # Output directory at monorepo root
    dist_dir = agent_dir.parent.parent / "dist"
    dist_dir.mkdir(exist_ok=True)
    
    print(f"[build-agent] ===== Stuard AI Agent Build =====")
    print(f"[build-agent] Platform: {platform.system()} {platform.machine()}")
    print(f"[build-agent] Python: {sys.version}")
    print(f"[build-agent] Agent dir: {agent_dir}")
    print(f"[build-agent] Output dir: {dist_dir}")
    print()
    
    # Clean previous build artifacts
    clean_directory(agent_dir / "build")
    clean_directory(agent_dir / "dist")
    
    # Verify spec file exists
    spec_file = agent_dir / "stuard-agent.spec"
    if not spec_file.exists():
        print(f"[build-agent] ERROR: Spec file not found: {spec_file}")
        sys.exit(1)
    
    # Run PyInstaller with verbose output
    cmd = [
        sys.executable, '-m', 'PyInstaller',
        '--clean',
        '--noconfirm',
        '--log-level', 'INFO',
        str(spec_file)
    ]
    
    print(f"[build-agent] Running PyInstaller...")
    print(f"[build-agent] Command: {' '.join(cmd)}")
    print()
    
    result = subprocess.run(cmd, cwd=agent_dir)
    
    if result.returncode != 0:
        print()
        print("[build-agent] ERROR: PyInstaller failed with exit code", result.returncode)
        sys.exit(1)
    
    print()
    print("[build-agent] PyInstaller completed successfully")
    
    # Find the built executable
    local_dist = agent_dir / "dist"
    if not local_dist.exists():
        print("[build-agent] ERROR: PyInstaller did not create dist/")
        sys.exit(1)
    
    # Platform-specific executable name
    if sys.platform == 'win32':
        exe_name = "stuard-agent.exe"
    elif sys.platform == 'darwin':
        exe_name = "stuard-agent-macos"
    else:
        exe_name = "stuard-agent-linux"
    
    src_exe = local_dist / exe_name
    dest_exe = dist_dir / exe_name
    
    if not src_exe.exists():
        print(f"[build-agent] ERROR: Expected executable not found: {src_exe}")
        print(f"[build-agent] Contents of {local_dist}:")
        for f in local_dist.iterdir():
            print(f"  - {f.name} ({f.stat().st_size / (1024*1024):.1f} MB)" if f.is_file() else f"  - {f.name}/ (dir)")
        sys.exit(1)
    
    # Copy to monorepo dist/ (use copy in case of cross-device move issues)
    print(f"[build-agent] Copying {src_exe.name} -> {dest_exe}")
    
    # Remove existing if present
    if dest_exe.exists():
        dest_exe.unlink()
    
    shutil.copy2(str(src_exe), str(dest_exe))
    
    # Make executable on Unix
    if sys.platform != 'win32':
        os.chmod(dest_exe, 0o755)
        print(f"[build-agent] Set executable permissions")
    
    # Final stats
    size_mb = dest_exe.stat().st_size / (1024 * 1024)
    print()
    print(f"[build-agent] ===== BUILD SUCCESS =====")
    print(f"[build-agent] Output: {dest_exe}")
    print(f"[build-agent] Size: {size_mb:.1f} MB")
    
    # Quick smoke test on same platform
    if sys.platform == 'win32' or (sys.platform in ('darwin', 'linux') and os.access(dest_exe, os.X_OK)):
        print(f"[build-agent] Executable is ready for packaging")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[build-agent] Build cancelled")
        sys.exit(130)
    except Exception as e:
        print(f"\n[build-agent] FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
