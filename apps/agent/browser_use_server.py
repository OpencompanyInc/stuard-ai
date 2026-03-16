"""
browser-use bridge server — lightweight HTTP wrapper around the browser-use library.
Managed by the Stuard desktop app as a child process.

Requires: pip install browser-use aiohttp
Runs on port 18082 by default.
"""

from browser_server import main

if __name__ == "__main__":
    main()
