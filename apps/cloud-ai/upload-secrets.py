#!/usr/bin/env python3
"""
Upload .env values to Google Secret Manager
Cross-platform: Works on Windows, macOS, Linux

Project: stuard-ai
Usage: python upload-secrets.py [path/to/.env]
"""
import os
import subprocess
import sys
from pathlib import Path


def main():
    # Determine .env file path
    if len(sys.argv) > 1:
        env_file = Path(sys.argv[1])
    else:
        # Default: apps/cloud-ai/.env relative to this script
        script_dir = Path(__file__).parent
        env_file = script_dir.parent / "apps" / "cloud-ai" / ".env"
    
    project = "stuard-ai"
    
    if not env_file.exists():
        print(f"Error: .env file not found at {env_file}")
        sys.exit(1)
    
    print(f"Reading .env from: {env_file}")
    print(f"Project: {project}")
    print()
    
    with open(env_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            
            # Skip empty lines and comments
            if not line or line.startswith("#"):
                continue
            
            # Parse KEY=value
            if "=" not in line:
                continue
            
            key, sep, val = line.partition("=")
            key = key.strip()
            val = val.strip()
            
            if not key:
                continue
            
            # Remove surrounding quotes if present
            if (val.startswith('"') and val.endswith('"')) or \
               (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]
            
            if not val:
                continue
            
            # Write to temp file for gcloud
            tmp_file = Path("./tmp_secret.txt")
            tmp_file.write_text(val, encoding="utf-8")
            
            print(f"Uploading {key}...")
            
            try:
                result = subprocess.run(
                    [
                        "gcloud", "secrets", "versions", "add", key,
                        f"--data-file={tmp_file}",
                        f"--project={project}"
                    ],
                    capture_output=True,
                    text=True
                )
                
                if result.returncode != 0:
                    print(f"  Warning: {result.stderr.strip()}")
                else:
                    print(f"  OK")
            except FileNotFoundError:
                print("  Error: gcloud CLI not found. Install from: https://cloud.google.com/sdk")
                sys.exit(1)
            finally:
                # Clean up temp file
                if tmp_file.exists():
                    tmp_file.unlink()
    
    print()
    print("All .env values uploaded to Google Secret Manager.")


if __name__ == "__main__":
    main()
