# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for the Stuard wake word listener.
#
# The model weights are bundled with the desktop app under resources/wakeword.
# The executable uses the command-style listen.py entry point and remains
# compatible with legacy flag-only invocation.

import os
import sys

block_cipher = None

if sys.platform == 'win32':
    exe_name = 'stuard-wakeword'
elif sys.platform == 'darwin':
    exe_name = 'stuard-wakeword-macos'
else:
    exe_name = 'stuard-wakeword-linux'

root_dir = os.path.abspath(os.path.join(os.getcwd(), '..', '..'))
wakeword_dir = os.path.join(root_dir, 'apps', 'desktop', 'resources', 'wakeword')
wakeword_script = os.path.join(wakeword_dir, 'listen.py')

hidden_imports = [
    'numpy',
    'numpy.core',
    'numpy.core.multiarray',
    'numpy.core._multiarray_umath',
    'sounddevice',
    '_sounddevice',
    'cffi',
    'cffi.api',
]

datas = []
try:
    import sounddevice
    sd_dir = os.path.dirname(sounddevice.__file__)
    sd_data_dir = os.path.join(sd_dir, '_sounddevice_data')
    if os.path.isdir(sd_data_dir):
        datas.append((sd_data_dir, '_sounddevice_data'))
except Exception:
    print('WARNING: sounddevice data files were not collected.')

a = Analysis(
    [wakeword_script],
    pathex=[wakeword_dir],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter', 'scipy', 'pandas', 'matplotlib', 'PIL',
        'pytest', 'test', 'tests',
        'torch', 'tensorflow', 'onnxruntime',
        'mediapipe', 'cv2', 'playwright',
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
