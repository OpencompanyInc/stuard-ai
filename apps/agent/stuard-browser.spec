# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for Stuard Browser Server
# Builds a standalone executable that runs the browser automation HTTP server.
# No Python or pip install required on the target machine — just run the binary.
#
# Playwright Chromium is NOT bundled (too large ~400MB). The desktop app handles
# Chromium installation separately via `playwright install chromium` on first use,
# or the packaged binary detects and downloads it at startup.

import sys
import os

block_cipher = None

if sys.platform == 'win32':
    exe_name = 'stuard-browser'
elif sys.platform == 'darwin':
    exe_name = 'stuard-browser-macos'
else:
    exe_name = 'stuard-browser-linux'

hidden_imports = [
    # aiohttp server
    'aiohttp',
    'aiohttp.web',
    'aiohttp.web_app',
    'aiohttp.web_request',
    'aiohttp.web_response',
    'aiohttp.web_runner',
    'aiohttp.web_server',
    'aiohttp.web_middlewares',
    'aiohttp.web_routedef',
    'aiohttp.web_urldispatcher',
    'aiohttp.http',
    'aiohttp.http_parser',
    'aiohttp.http_writer',
    'aiohttp.http_websocket',
    'aiohttp.connector',
    'aiohttp.client',
    'aiohttp.multipart',
    'multidict',
    'yarl',
    'frozenlist',
    'aiosignal',
    'async_timeout',
    'attrs',
    # Playwright
    'playwright',
    'playwright.async_api',
    'playwright.async_api._generated',
    'playwright._impl',
    'playwright._impl._api_types',
    'playwright._impl._browser',
    'playwright._impl._browser_context',
    'playwright._impl._browser_type',
    'playwright._impl._page',
    'playwright._impl._connection',
    'playwright._impl._transport',
    'greenlet',
    'pyee',
    'pyee.asyncio',
    # Image processing (for screenshot resize)
    'PIL',
    'PIL.Image',
    'PIL.ImageFile',
    'PIL.JpegImagePlugin',
    'PIL.PngImagePlugin',
    # Crypto (auth token generation)
    'cryptography',
    # Asyncio internals
    'asyncio',
    'asyncio.events',
    'asyncio.base_events',
    # Our modules
    'browser_server',
    'browser_server.state',
    'browser_server.lifecycle',
    'browser_server.profile',
    'browser_server.utils',
    'browser_server.handlers_config',
    'browser_server.handlers_content',
    'browser_server.handlers_nav',
    'browser_server.handlers_tabs',
    'browser_server.handlers_advanced',
    # Encoding
    'encodings',
    'encodings.idna',
]

# Platform-specific
if sys.platform == 'win32':
    hidden_imports.extend(['ctypes', 'ctypes.wintypes'])

a = Analysis(
    ['browser_server_main.py'],
    pathex=[os.path.abspath('.')],
    binaries=[],
    datas=[],
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter', 'matplotlib', 'scipy', 'numpy.distutils',
        'setuptools', 'wheel', 'pip', 'pytest', 'test', 'tests',
        # Exclude heavy stuff not needed for browser server
        'lancedb', 'pyarrow', 'sounddevice', 'soundfile',
        'pyautogui', 'pyscreeze', 'mss',
        'mediapipe', 'cv2',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name=exe_name,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='icon.ico' if sys.platform == 'win32' else None,
)
