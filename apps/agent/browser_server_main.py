"""
Browser automation server — lightweight HTTP wrapper around Playwright + CDP.
Managed by the Stuard desktop app as a child process.

Requires: pip install playwright aiohttp cryptography
Runs on port 18082 by default.
"""

from browser_server import main

if __name__ == "__main__":
    main()
