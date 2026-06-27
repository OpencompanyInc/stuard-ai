# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for Stuard MediaPipe Service
# Builds a standalone executable that runs the MediaPipe HTTP server.
# Bundles mediapipe, opencv, numpy — no Python or pip needed.
#
# NOTE: This produces a larger binary (~200-300MB) because it includes
# the mediapipe runtime and OpenCV. Models are NOT bundled — they are
# downloaded from Google on first use (~30MB total).

import sys
import os

block_cipher = None

if sys.platform == 'win32':
    exe_name = 'stuard-mediapipe'
elif sys.platform == 'darwin':
    exe_name = 'stuard-mediapipe-macos'
else:
    exe_name = 'stuard-mediapipe-linux'

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
    'multidict',
    'yarl',
    'frozenlist',
    'aiosignal',
    'async_timeout',
    'attrs',
    # MediaPipe
    'mediapipe',
    'mediapipe.tasks',
    'mediapipe.tasks.python',
    'mediapipe.tasks.python.vision',
    'mediapipe.tasks.python.core',
    'mediapipe.tasks.python.core.base_options',
    'mediapipe.python',
    'mediapipe.python.solutions',
    'mediapipe.python.solutions.drawing_utils',
    'mediapipe.python.solutions.drawing_styles',
    'mediapipe.python.solutions.pose',
    'mediapipe.python.solutions.hands',
    'mediapipe.python.solutions.face_mesh',
    # OpenCV
    'cv2',
    # NumPy
    'numpy',
    'numpy.core',
    'numpy.core.multiarray',
    'numpy.core._multiarray_umath',
    # Image processing
    'PIL',
    'PIL.Image',
    'PIL.JpegImagePlugin',
    'PIL.PngImagePlugin',
    # Flatbuffers (mediapipe dependency)
    'flatbuffers',
    # Protobuf (mediapipe dependency)
    'google.protobuf',
    'google.protobuf.descriptor',
    'google.protobuf.message',
    # Asyncio
    'asyncio',
    'asyncio.events',
    # Encoding
    'encodings',
    'encodings.idna',
]

# Platform-specific
if sys.platform == 'win32':
    hidden_imports.extend(['ctypes', 'ctypes.wintypes'])

# Collect mediapipe data files (tflite configs, etc.)
datas = []
try:
    import mediapipe
    mp_dir = os.path.dirname(mediapipe.__file__)
    # Include the modules directory which has configs and calculators
    modules_dir = os.path.join(mp_dir, 'modules')
    if os.path.isdir(modules_dir):
        datas.append((modules_dir, os.path.join('mediapipe', 'modules')))
    # Include python/solutions data
    solutions_dir = os.path.join(mp_dir, 'python', 'solutions')
    if os.path.isdir(solutions_dir):
        datas.append((solutions_dir, os.path.join('mediapipe', 'python', 'solutions')))
    # Include tasks
    tasks_dir = os.path.join(mp_dir, 'tasks')
    if os.path.isdir(tasks_dir):
        datas.append((tasks_dir, os.path.join('mediapipe', 'tasks')))
except ImportError:
    print("WARNING: mediapipe not found in current environment. Install it before building.")

a = Analysis(
    ['mediapipe_service.py'],
    pathex=[os.path.abspath('.')],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter', 'scipy', 'setuptools', 'wheel', 'pip',
        'pytest', 'test', 'tests',
        # Exclude things not needed
        'lancedb', 'pyarrow', 'sounddevice', 'soundfile',
        'pyautogui', 'pyscreeze', 'mss',
        'playwright',
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
