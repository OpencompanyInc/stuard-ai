# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for Stuard AI Agent
# Builds a single-file executable for Windows/macOS/Linux

import sys
import os

block_cipher = None

# Determine platform-specific output name
if sys.platform == 'win32':
    exe_name = 'stuard-agent'  # .exe added automatically
elif sys.platform == 'darwin':
    exe_name = 'stuard-agent-macos'
else:
    exe_name = 'stuard-agent-linux'

# Hidden imports that PyInstaller might miss
hidden_imports = [
    # Uvicorn internals
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.http.httptools_impl',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.protocols.websockets.websockets_impl',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'uvicorn.lifespan.off',
    # FastAPI/Starlette
    'starlette',
    'starlette.routing',
    'starlette.middleware',
    'starlette.middleware.cors',
    'starlette.responses',
    'starlette.websockets',
    'anyio',
    'anyio._backends',
    'anyio._backends._asyncio',
    # WebSockets
    'websockets',
    'websockets.legacy',
    'websockets.legacy.client',
    'websockets.client',
    # Platform automation
    'pyautogui',
    'pyperclip',
    'pyscreeze',
    # Screenshots - platform specific
    'mss',
    'mss.base',
    'mss.tools',
]

# Add platform-specific mss backend
if sys.platform == 'win32':
    hidden_imports.extend(['mss.windows', 'ctypes', 'ctypes.wintypes'])
elif sys.platform == 'darwin':
    hidden_imports.extend(['mss.darwin', 'Quartz', 'AppKit'])
else:
    hidden_imports.extend(['mss.linux'])

hidden_imports.extend([
    # Image processing
    'PIL',
    'PIL.Image',
    'PIL.ImageGrab',
    # Database
    'lancedb',
    'pyarrow',
    'pyarrow.lib',
    'pyarrow._compute',
    'pyarrow.compute',
    # Audio
    'sounddevice',
    'soundfile',
    '_sounddevice_data',
    # Pydantic
    'pydantic',
    'pydantic.deprecated',
    'pydantic.deprecated.decorator',
    'pydantic_core',
    'pydantic_core._pydantic_core',
    # Env
    'dotenv',
    # App modules
    'app',
    'app.main',
    'app.config',
    'app.db',
    'app.connections',
    'app.logging_config',
    'app.storage',
    'app.storage.tasks_db',
    'app.tools',
    'app.tools.dispatch',
    'app.tools.memory',
    'app.tools.system',
    'app.tools.screenshots',
    'app.tools.tasks',
    'app.routes',
    'app.routes.core',
    # HTTP
    'httptools',
    'h11',
    # Encoding
    'encodings',
    'encodings.idna',
])

# Data files to bundle
datas = [
    (os.path.join('app', 'data', 'wakeword', 'kws_weights.npz'), os.path.join('app', 'data', 'wakeword')),
]

# Collect binaries for sounddevice (needs libportaudio)
binaries = []

a = Analysis(
    ['app/main.py'],
    pathex=[os.path.abspath('.')],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'scipy',
        'numpy.distutils',
        'setuptools',
        'wheel',
        'pip',
        'pytest',
        'test',
        'tests',
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
    console=True,  # Console app for logging
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
