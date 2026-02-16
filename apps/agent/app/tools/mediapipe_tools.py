"""
MediaPipe integration tools for pose estimation, hand tracking, face detection,
face mesh, object detection, and image segmentation.

Auto-installs mediapipe + opencv-python on first use via a managed venv.
Uses the mediapipe.tasks API (required for Python 3.13+).
Returns landmark coordinates as structured JSON and optionally draws annotations
on the output image/frames.
"""

from __future__ import annotations

import asyncio
import base64
import importlib
import os
import sys
import uuid
from typing import Any, Awaitable, Callable, Dict, List, Optional
from urllib.request import urlretrieve

# ---------------------------------------------------------------------------
# Lazy dependency management
# ---------------------------------------------------------------------------

_MP_ENV_ID = "mediapipe_env"
_REQUIRED_PACKAGES = ["mediapipe", "opencv-python", "numpy"]
_env_ready = False

# Model download URLs (Google-hosted, stable)
_MODEL_URLS: Dict[str, str] = {
    "pose_landmarker": "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
    "hand_landmarker": "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
    "face_detector": "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite",
    "face_landmarker": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
    "image_segmenter": "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
}


def _models_dir() -> str:
    d = os.path.join(os.path.expanduser("~"), "StuardAI", "mediapipe", "models")
    os.makedirs(d, exist_ok=True)
    return d


def _get_model_path(model_key: str) -> str:
    """Return local path to a model file, downloading it if missing."""
    url = _MODEL_URLS[model_key]
    filename = url.rsplit("/", 1)[-1]
    local = os.path.join(_models_dir(), filename)
    if not os.path.isfile(local):
        urlretrieve(url, local)
    return local


def _ensure_venv_on_path() -> None:
    """If the managed mediapipe venv exists, ensure its site-packages is on sys.path."""
    from . import system as _sys
    envs_root = _sys._envs_base_dir()
    env_dir = os.path.join(envs_root, _MP_ENV_ID)
    if not os.path.isdir(env_dir):
        return
    if sys.platform == "win32":
        sp = os.path.join(env_dir, "Lib", "site-packages")
    else:
        py_ver = f"python{sys.version_info.major}.{sys.version_info.minor}"
        sp = os.path.join(env_dir, "lib", py_ver, "site-packages")
    if os.path.isdir(sp) and sp not in sys.path:
        sys.path.insert(0, sp)
        importlib.invalidate_caches()
        # Purge stale mediapipe modules so reimport finds the venv version
        stale = [k for k in sys.modules if k == "mediapipe" or k.startswith("mediapipe.")]
        for k in stale:
            del sys.modules[k]


# ---------------------------------------------------------------------------
# STATUS & SETUP (for Integrations dashboard)
# ---------------------------------------------------------------------------

async def mediapipe_status(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Optional[Dict[str, Any]]], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """Check if MediaPipe is installed and available."""
    global _env_ready
    # Make sure the managed venv is on sys.path (survives agent restarts)
    _ensure_venv_on_path()
    try:
        mp = importlib.import_module("mediapipe")
        importlib.import_module("cv2")
        importlib.import_module("numpy")
        # Verify tasks API exists
        importlib.import_module("mediapipe.tasks")
        version = getattr(mp, "__version__", "unknown")
        _env_ready = True
        return {"ok": True, "available": True, "version": version}
    except ImportError:
        return {"ok": True, "available": False, "version": None}


async def mediapipe_setup(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Optional[Dict[str, Any]]], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    """Install MediaPipe + opencv-python + numpy into a managed environment."""
    try:
        await _ensure_mediapipe(emit)
        mp = importlib.import_module("mediapipe")
        version = getattr(mp, "__version__", "unknown")
        return {"ok": True, "available": True, "version": version, "message": "MediaPipe is ready."}
    except Exception as e:
        return {"ok": False, "available": False, "error": str(e)}


async def _ensure_mediapipe(
    emit: Optional[Callable[[str, Optional[Dict[str, Any]]], Awaitable[None]]] = None,
) -> None:
    """Ensure mediapipe + opencv are importable. Creates a venv if needed."""
    global _env_ready
    if _env_ready:
        return

    # Try existing venv first (survives agent restarts)
    _ensure_venv_on_path()

    try:
        importlib.import_module("mediapipe")
        importlib.import_module("cv2")
        importlib.import_module("numpy")
        importlib.import_module("mediapipe.tasks")
        _env_ready = True
        return
    except ImportError:
        pass

    # Purge stale mediapipe modules so reinstall picks up the correct version
    stale = [k for k in sys.modules if k == "mediapipe" or k.startswith("mediapipe.")]
    for k in stale:
        del sys.modules[k]

    from . import system as _sys

    if emit:
        await emit("mediapipe_setup", {"status": "installing", "packages": _REQUIRED_PACKAGES})

    setup_result = await _sys.python_setup({"envId": _MP_ENV_ID})
    if not setup_result.get("ok") and "already exists" not in str(setup_result.get("error", "")):
        raise RuntimeError(f"Failed to create mediapipe env: {setup_result}")

    for pkg in _REQUIRED_PACKAGES:
        if emit:
            await emit("mediapipe_setup", {"status": "installing_package", "package": pkg})
        install_result = await _sys.python_install({"envId": _MP_ENV_ID, "packages": [pkg]})
        if not install_result.get("ok"):
            raise RuntimeError(f"Failed to install {pkg}: {install_result}")

    # Add newly created venv to sys.path
    _ensure_venv_on_path()

    if emit:
        await emit("mediapipe_setup", {"status": "ready"})

    _env_ready = True


def _get_output_dir() -> str:
    base = os.path.join(os.path.expanduser("~"), "StuardAI", "mediapipe")
    os.makedirs(base, exist_ok=True)
    return base


def _load_image(path: str):
    import cv2
    img = cv2.imread(path)
    if img is None:
        raise FileNotFoundError(f"Cannot read image: {path}")
    return img


def _load_image_from_data_url(data_url: str):
    """Decode a data:image/...;base64,... string to a BGR numpy array (no disk I/O)."""
    import cv2
    import numpy as np
    # Strip the data URL prefix
    if ',' in data_url:
        b64_str = data_url.split(',', 1)[1]
    else:
        b64_str = data_url
    raw = base64.b64decode(b64_str)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode base64 image data")
    return img


def _encode_image_to_data_url(img, quality: int = 80) -> str:
    """Encode a BGR numpy array to a data:image/jpeg;base64,... string (no disk I/O)."""
    import cv2
    ok, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("Failed to encode image as JPEG")
    b64 = base64.b64encode(buf.tobytes()).decode('ascii')
    return f"data:image/jpeg;base64,{b64}"


def _save_image(img, output_path: Optional[str] = None) -> str:
    import cv2
    if not output_path:
        output_path = os.path.join(_get_output_dir(), f"mp_{uuid.uuid4().hex[:8]}.png")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    cv2.imwrite(output_path, img)
    return output_path


def _nml_to_list(landmarks, image_width: int = 0, image_height: int = 0) -> List[Dict[str, Any]]:
    """Convert a NormalizedLandmark list (tasks API) to serialisable dicts."""
    result = []
    for i, lm in enumerate(landmarks):
        entry: Dict[str, Any] = {
            "index": i,
            "x": round(lm.x, 6),
            "y": round(lm.y, 6),
            "z": round(lm.z, 6),
        }
        if hasattr(lm, "visibility") and lm.visibility is not None:
            entry["visibility"] = round(lm.visibility, 4)
        if image_width and image_height:
            entry["px_x"] = int(lm.x * image_width)
            entry["px_y"] = int(lm.y * image_height)
        result.append(entry)
    return result


# ---------------------------------------------------------------------------
# Drawing helpers (replaces removed mp.solutions.drawing_utils)
# ---------------------------------------------------------------------------

def _draw_landmarks_on_image(img, landmarks, connections=None, color=(0, 255, 0), thickness=2, radius=3):
    """Draw landmarks and optional connections on a BGR image (cv2 format)."""
    import cv2
    h, w = img.shape[:2]
    pts = [(int(lm.x * w), int(lm.y * h)) for lm in landmarks]
    if connections:
        for start_idx, end_idx in connections:
            if start_idx < len(pts) and end_idx < len(pts):
                cv2.line(img, pts[start_idx], pts[end_idx], color, thickness)
    for pt in pts:
        cv2.circle(img, pt, radius, color, -1)


def _draw_bboxes_on_image(img, detections, color=(0, 255, 0), thickness=2):
    """Draw bounding boxes from FaceDetectorResult on a BGR image."""
    import cv2
    h, w = img.shape[:2]
    for det in detections:
        bb = det.bounding_box
        x1, y1 = bb.origin_x, bb.origin_y
        x2, y2 = x1 + bb.width, y1 + bb.height
        cv2.rectangle(img, (x1, y1), (x2, y2), color, thickness)
        if det.categories:
            score = det.categories[0].score
            cv2.putText(img, f"{score:.2f}", (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)


# ---------------------------------------------------------------------------
# Connection tuples for drawing (mirrors the old solutions constants)
# ---------------------------------------------------------------------------

def _get_pose_connections():
    from mediapipe.tasks.python.vision import PoseLandmarksConnections
    return [(c.start, c.end) for c in PoseLandmarksConnections.POSE_LANDMARKS]


def _get_hand_connections():
    from mediapipe.tasks.python.vision import HandLandmarksConnections
    return [(c.start, c.end) for c in HandLandmarksConnections.HAND_CONNECTIONS]


def _get_face_connections():
    from mediapipe.tasks.python.vision import FaceLandmarksConnections
    all_conns = set()
    for attr in dir(FaceLandmarksConnections):
        val = getattr(FaceLandmarksConnections, attr)
        if isinstance(val, (list, frozenset)):
            for c in val:
                if hasattr(c, "start") and hasattr(c, "end"):
                    all_conns.add((c.start, c.end))
    return list(all_conns)


# ---------------------------------------------------------------------------
# POSE ESTIMATION
# ---------------------------------------------------------------------------

async def mediapipe_pose(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Optional[Dict[str, Any]]], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    await _ensure_mediapipe(emit)
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import PoseLandmarker, PoseLandmarkerOptions, RunningMode

    image_path = str(args.get("imagePath") or "").strip()
    image_data = str(args.get("imageData") or "").strip()
    output_path = str(args.get("outputPath") or "").strip() or None
    output_format = str(args.get("outputFormat") or "base64").strip().lower()
    draw = bool(args.get("drawLandmarks", True))
    min_det = float(args.get("minDetectionConfidence", 0.5))
    min_track = float(args.get("minTrackingConfidence", 0.5))

    if not image_path and not image_data:
        return {"ok": False, "error": "imagePath or imageData is required"}

    if emit:
        await emit("mediapipe_processing", {"task": "pose"})

    model_path = await asyncio.to_thread(_get_model_path, "pose_landmarker")
    options = PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=model_path),
        running_mode=RunningMode.IMAGE,
        num_poses=1,
        min_pose_detection_confidence=min_det,
        min_tracking_confidence=min_track,
    )

    # Load image: prefer in-memory base64 (zero I/O) over file path
    if image_data and image_data.startswith("data:"):
        img = _load_image_from_data_url(image_data)
    else:
        img = await asyncio.to_thread(_load_image, image_path)
    h, w = img.shape[:2]
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    with PoseLandmarker.create_from_options(options) as landmarker:
        result = landmarker.detect(mp_image)

    if not result.pose_landmarks:
        return {"ok": True, "poseDetected": False, "landmarks": [], "landmarkCount": 0}

    landmarks = _nml_to_list(result.pose_landmarks[0], w, h)

    out_path = None
    out_data_url = None
    if draw:
        annotated = img.copy()
        conns = _get_pose_connections()
        for pose_lms in result.pose_landmarks:
            _draw_landmarks_on_image(annotated, pose_lms, conns, color=(0, 255, 0))
        if output_format == 'file' or output_path:
            if not output_path:
                output_path = os.path.join(_get_output_dir(), f"mp_pose_{uuid.uuid4().hex[:8]}.png")
            out_path = await asyncio.to_thread(_save_image, annotated, output_path)
        if output_format == 'base64' or not output_path:
            out_data_url = _encode_image_to_data_url(annotated)

    return {
        "ok": True,
        "poseDetected": True,
        "landmarks": landmarks,
        "landmarkCount": len(landmarks),
        "outputPath": out_path,
        "outputDataUrl": out_data_url,
    }


# ---------------------------------------------------------------------------
# HAND TRACKING
# ---------------------------------------------------------------------------

async def mediapipe_hands(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Optional[Dict[str, Any]]], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    await _ensure_mediapipe(emit)
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import HandLandmarker, HandLandmarkerOptions, RunningMode

    image_path = str(args.get("imagePath") or "").strip()
    image_data = str(args.get("imageData") or "").strip()
    output_path = str(args.get("outputPath") or "").strip() or None
    output_format = str(args.get("outputFormat") or "base64").strip().lower()
    draw = bool(args.get("drawLandmarks", True))
    max_hands = int(args.get("maxNumHands", 2))
    min_det = float(args.get("minDetectionConfidence", 0.5))
    min_track = float(args.get("minTrackingConfidence", 0.5))

    if not image_path and not image_data:
        return {"ok": False, "error": "imagePath or imageData is required"}

    if emit:
        await emit("mediapipe_processing", {"task": "hands"})

    model_path = await asyncio.to_thread(_get_model_path, "hand_landmarker")
    options = HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=model_path),
        running_mode=RunningMode.IMAGE,
        num_hands=max_hands,
        min_hand_detection_confidence=min_det,
        min_tracking_confidence=min_track,
    )

    if image_data and image_data.startswith("data:"):
        img = _load_image_from_data_url(image_data)
    else:
        img = await asyncio.to_thread(_load_image, image_path)
    h, w = img.shape[:2]
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    with HandLandmarker.create_from_options(options) as landmarker:
        result = landmarker.detect(mp_image)

    if not result.hand_landmarks:
        return {"ok": True, "hands": [], "handCount": 0}

    hand_data = []
    for i, hand_lms in enumerate(result.hand_landmarks):
        handedness = "Unknown"
        if result.handedness and i < len(result.handedness):
            handedness = result.handedness[i][0].category_name
        hand_data.append({
            "landmarks": _nml_to_list(hand_lms, w, h),
            "handedness": handedness,
        })

    out_path = None
    out_data_url = None
    if draw:
        annotated = img.copy()
        conns = _get_hand_connections()
        for hand_lms in result.hand_landmarks:
            _draw_landmarks_on_image(annotated, hand_lms, conns, color=(255, 0, 0))
        if output_format == 'file' or output_path:
            if not output_path:
                output_path = os.path.join(_get_output_dir(), f"mp_hands_{uuid.uuid4().hex[:8]}.png")
            out_path = await asyncio.to_thread(_save_image, annotated, output_path)
        if output_format == 'base64' or not output_path:
            out_data_url = _encode_image_to_data_url(annotated)

    return {"ok": True, "hands": hand_data, "handCount": len(hand_data), "outputPath": out_path, "outputDataUrl": out_data_url}


# ---------------------------------------------------------------------------
# FACE DETECTION
# ---------------------------------------------------------------------------

async def mediapipe_face_detection(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Optional[Dict[str, Any]]], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    await _ensure_mediapipe(emit)
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import FaceDetector, FaceDetectorOptions, RunningMode

    image_path = str(args.get("imagePath") or "").strip()
    image_data = str(args.get("imageData") or "").strip()
    output_path = str(args.get("outputPath") or "").strip() or None
    output_format = str(args.get("outputFormat") or "base64").strip().lower()
    draw = bool(args.get("drawDetections", True))
    min_det = float(args.get("minDetectionConfidence", 0.5))

    if not image_path and not image_data:
        return {"ok": False, "error": "imagePath or imageData is required"}

    if emit:
        await emit("mediapipe_processing", {"task": "face_detection"})

    model_path = await asyncio.to_thread(_get_model_path, "face_detector")
    options = FaceDetectorOptions(
        base_options=BaseOptions(model_asset_path=model_path),
        running_mode=RunningMode.IMAGE,
        min_detection_confidence=min_det,
    )

    if image_data and image_data.startswith("data:"):
        img = _load_image_from_data_url(image_data)
    else:
        img = await asyncio.to_thread(_load_image, image_path)
    h, w = img.shape[:2]
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    with FaceDetector.create_from_options(options) as detector:
        result = detector.detect(mp_image)

    if not result.detections:
        return {"ok": True, "faces": [], "faceCount": 0}

    faces = []
    for det in result.detections:
        bb = det.bounding_box
        keypoints = []
        if det.keypoints:
            for kp in det.keypoints:
                keypoints.append({"x": round(kp.x, 6), "y": round(kp.y, 6), "px_x": int(kp.x * w), "px_y": int(kp.y * h)})
        score = det.categories[0].score if det.categories else 0
        faces.append({
            "bbox": {
                "x": round(bb.origin_x / w, 6), "y": round(bb.origin_y / h, 6),
                "width": round(bb.width / w, 6), "height": round(bb.height / h, 6),
                "px_x": bb.origin_x, "px_y": bb.origin_y,
                "px_width": bb.width, "px_height": bb.height,
            },
            "keypoints": keypoints,
            "confidence": round(score, 4),
        })

    out_path = None
    out_data_url = None
    if draw:
        annotated = img.copy()
        _draw_bboxes_on_image(annotated, result.detections)
        if output_format == 'file' or output_path:
            if not output_path:
                output_path = os.path.join(_get_output_dir(), f"mp_face_{uuid.uuid4().hex[:8]}.png")
            out_path = await asyncio.to_thread(_save_image, annotated, output_path)
        if output_format == 'base64' or not output_path:
            out_data_url = _encode_image_to_data_url(annotated)

    return {"ok": True, "faces": faces, "faceCount": len(faces), "outputPath": out_path, "outputDataUrl": out_data_url}


# ---------------------------------------------------------------------------
# FACE MESH (478 landmarks)
# ---------------------------------------------------------------------------

async def mediapipe_face_mesh(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Optional[Dict[str, Any]]], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    await _ensure_mediapipe(emit)
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import FaceLandmarker, FaceLandmarkerOptions, RunningMode

    image_path = str(args.get("imagePath") or "").strip()
    image_data = str(args.get("imageData") or "").strip()
    output_path = str(args.get("outputPath") or "").strip() or None
    output_format = str(args.get("outputFormat") or "base64").strip().lower()
    draw = bool(args.get("drawLandmarks", True))
    max_faces = int(args.get("maxNumFaces", 1))
    min_det = float(args.get("minDetectionConfidence", 0.5))
    min_track = float(args.get("minTrackingConfidence", 0.5))

    if not image_path and not image_data:
        return {"ok": False, "error": "imagePath or imageData is required"}

    if emit:
        await emit("mediapipe_processing", {"task": "face_mesh"})

    model_path = await asyncio.to_thread(_get_model_path, "face_landmarker")
    options = FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=model_path),
        running_mode=RunningMode.IMAGE,
        num_faces=max_faces,
        min_face_detection_confidence=min_det,
        min_tracking_confidence=min_track,
    )

    if image_data and image_data.startswith("data:"):
        img = _load_image_from_data_url(image_data)
    else:
        img = await asyncio.to_thread(_load_image, image_path)
    h, w = img.shape[:2]
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    with FaceLandmarker.create_from_options(options) as landmarker:
        result = landmarker.detect(mp_image)

    if not result.face_landmarks:
        return {"ok": True, "faces": [], "faceCount": 0}

    face_data = []
    for face_lms in result.face_landmarks:
        face_data.append({"landmarks": _nml_to_list(face_lms, w, h), "landmarkCount": len(face_lms)})

    out_path = None
    out_data_url = None
    if draw:
        annotated = img.copy()
        conns = _get_face_connections()
        for face_lms in result.face_landmarks:
            _draw_landmarks_on_image(annotated, face_lms, conns, color=(0, 200, 200), thickness=1, radius=1)
        if output_format == 'file' or output_path:
            if not output_path:
                output_path = os.path.join(_get_output_dir(), f"mp_mesh_{uuid.uuid4().hex[:8]}.png")
            out_path = await asyncio.to_thread(_save_image, annotated, output_path)
        if output_format == 'base64' or not output_path:
            out_data_url = _encode_image_to_data_url(annotated)

    return {"ok": True, "faces": face_data, "faceCount": len(face_data), "outputPath": out_path, "outputDataUrl": out_data_url}


# ---------------------------------------------------------------------------
# IMAGE SEGMENTATION (Selfie segmentation)
# ---------------------------------------------------------------------------

async def mediapipe_segmentation(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Optional[Dict[str, Any]]], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    await _ensure_mediapipe(emit)
    import cv2
    import numpy as np
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import ImageSegmenter, ImageSegmenterOptions, RunningMode

    image_path = str(args.get("imagePath") or "").strip()
    image_data = str(args.get("imageData") or "").strip()
    output_path = str(args.get("outputPath") or "").strip() or None
    output_format = str(args.get("outputFormat") or "base64").strip().lower()
    threshold = float(args.get("threshold", 0.5))
    bg_color = args.get("backgroundColor")
    blur_bg = bool(args.get("blurBackground", False))
    blur_strength = int(args.get("blurStrength", 21))

    if not image_path and not image_data:
        return {"ok": False, "error": "imagePath or imageData is required"}

    if emit:
        await emit("mediapipe_processing", {"task": "segmentation"})

    model_path = await asyncio.to_thread(_get_model_path, "image_segmenter")
    options = ImageSegmenterOptions(
        base_options=BaseOptions(model_asset_path=model_path),
        running_mode=RunningMode.IMAGE,
        output_category_mask=True,
        output_confidence_masks=True,
    )

    if image_data and image_data.startswith("data:"):
        img = _load_image_from_data_url(image_data)
    else:
        img = await asyncio.to_thread(_load_image, image_path)
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    with ImageSegmenter.create_from_options(options) as segmenter:
        result = segmenter.segment(mp_image)

    # Use the first confidence mask (foreground)
    if result.confidence_masks:
        mask = result.confidence_masks[0].numpy_view()
    else:
        mask = np.zeros(img.shape[:2], dtype=np.float32)

    binary_mask = (mask > threshold).astype(np.uint8)

    if blur_bg:
        blur_k = blur_strength if blur_strength % 2 == 1 else blur_strength + 1
        blurred = cv2.GaussianBlur(img, (blur_k, blur_k), 0)
        mask_3ch = np.stack([binary_mask] * 3, axis=-1)
        output = np.where(mask_3ch, img, blurred)
    elif bg_color:
        hex_c = str(bg_color).lstrip("#")
        r, g, b = int(hex_c[0:2], 16), int(hex_c[2:4], 16), int(hex_c[4:6], 16)
        bg = np.full_like(img, (b, g, r))
        mask_3ch = np.stack([binary_mask] * 3, axis=-1)
        output = np.where(mask_3ch, img, bg)
    else:
        alpha = (binary_mask * 255).astype(np.uint8)
        output = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
        output[:, :, 3] = alpha

    out_data_url = None
    out_path = None
    mask_path = None
    if output_format == 'file' or output_path:
        if not output_path:
            output_path = os.path.join(_get_output_dir(), f"mp_seg_{uuid.uuid4().hex[:8]}.png")
        out_path = await asyncio.to_thread(_save_image, output, output_path)
        mask_path = out_path.replace(".png", "_mask.png")
        mask_img = (mask * 255).astype(np.uint8)
        await asyncio.to_thread(_save_image, mask_img, mask_path)
    if output_format == 'base64' or not output_path:
        out_data_url = _encode_image_to_data_url(output)

    return {"ok": True, "outputPath": out_path, "maskPath": mask_path, "outputDataUrl": out_data_url}


# ---------------------------------------------------------------------------
# HOLISTIC (Pose + Hands + Face combined via separate landmarkers)
# ---------------------------------------------------------------------------

async def mediapipe_holistic(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Optional[Dict[str, Any]]], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    await _ensure_mediapipe(emit)
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import (
        PoseLandmarker, PoseLandmarkerOptions,
        HandLandmarker, HandLandmarkerOptions,
        FaceLandmarker, FaceLandmarkerOptions,
        RunningMode,
    )

    image_path = str(args.get("imagePath") or "").strip()
    image_data = str(args.get("imageData") or "").strip()
    output_path = str(args.get("outputPath") or "").strip() or None
    output_format = str(args.get("outputFormat") or "base64").strip().lower()
    draw = bool(args.get("drawLandmarks", True))
    min_det = float(args.get("minDetectionConfidence", 0.5))
    min_track = float(args.get("minTrackingConfidence", 0.5))

    if not image_path and not image_data:
        return {"ok": False, "error": "imagePath or imageData is required"}

    if emit:
        await emit("mediapipe_processing", {"task": "holistic"})

    if image_data and image_data.startswith("data:"):
        img = _load_image_from_data_url(image_data)
    else:
        img = await asyncio.to_thread(_load_image, image_path)
    h, w = img.shape[:2]
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    def _empty():
        return {"detected": False, "landmarks": [], "landmarkCount": 0}

    # Pose
    pose_model = await asyncio.to_thread(_get_model_path, "pose_landmarker")
    with PoseLandmarker.create_from_options(PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=pose_model),
        running_mode=RunningMode.IMAGE, num_poses=1,
        min_pose_detection_confidence=min_det, min_tracking_confidence=min_track,
    )) as pl:
        pose_r = pl.detect(mp_image)
    if pose_r.pose_landmarks:
        pose_data = {"detected": True, "landmarks": _nml_to_list(pose_r.pose_landmarks[0], w, h),
                     "landmarkCount": len(pose_r.pose_landmarks[0])}
    else:
        pose_data = _empty()

    # Hands
    hand_model = await asyncio.to_thread(_get_model_path, "hand_landmarker")
    with HandLandmarker.create_from_options(HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=hand_model),
        running_mode=RunningMode.IMAGE, num_hands=2,
        min_hand_detection_confidence=min_det, min_tracking_confidence=min_track,
    )) as hl:
        hand_r = hl.detect(mp_image)

    left_hand_data = _empty()
    right_hand_data = _empty()
    if hand_r.hand_landmarks:
        for i, hand_lms in enumerate(hand_r.hand_landmarks):
            side = "Left"
            if hand_r.handedness and i < len(hand_r.handedness):
                side = hand_r.handedness[i][0].category_name
            data = {"detected": True, "landmarks": _nml_to_list(hand_lms, w, h), "landmarkCount": len(hand_lms)}
            if side == "Left":
                left_hand_data = data
            else:
                right_hand_data = data

    # Face
    face_model = await asyncio.to_thread(_get_model_path, "face_landmarker")
    with FaceLandmarker.create_from_options(FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=face_model),
        running_mode=RunningMode.IMAGE, num_faces=1,
        min_face_detection_confidence=min_det, min_tracking_confidence=min_track,
    )) as fl:
        face_r = fl.detect(mp_image)
    if face_r.face_landmarks:
        face_data = {"detected": True, "landmarks": _nml_to_list(face_r.face_landmarks[0], w, h),
                     "landmarkCount": len(face_r.face_landmarks[0])}
    else:
        face_data = _empty()

    out_path = None
    out_data_url = None
    if draw:
        annotated = img.copy()
        if pose_data["detected"]:
            _draw_landmarks_on_image(annotated, pose_r.pose_landmarks[0], _get_pose_connections(), color=(0, 255, 0))
        if hand_r.hand_landmarks:
            conns = _get_hand_connections()
            for hand_lms in hand_r.hand_landmarks:
                _draw_landmarks_on_image(annotated, hand_lms, conns, color=(255, 0, 0))
        if face_data["detected"]:
            _draw_landmarks_on_image(annotated, face_r.face_landmarks[0], _get_face_connections(),
                                     color=(0, 200, 200), thickness=1, radius=1)
        if output_format == 'file' or output_path:
            if not output_path:
                output_path = os.path.join(_get_output_dir(), f"mp_holistic_{uuid.uuid4().hex[:8]}.png")
            out_path = await asyncio.to_thread(_save_image, annotated, output_path)
        if output_format == 'base64' or not output_path:
            out_data_url = _encode_image_to_data_url(annotated)

    return {"ok": True, "pose": pose_data, "leftHand": left_hand_data, "rightHand": right_hand_data,
            "face": face_data, "outputPath": out_path, "outputDataUrl": out_data_url}


# ---------------------------------------------------------------------------
# VIDEO PROCESSING
# ---------------------------------------------------------------------------

async def mediapipe_process_video(
    args: Dict[str, Any],
    emit: Optional[Callable[[str, Optional[Dict[str, Any]]], Awaitable[None]]] = None,
) -> Dict[str, Any]:
    await _ensure_mediapipe(emit)
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import (
        PoseLandmarker, PoseLandmarkerOptions,
        HandLandmarker, HandLandmarkerOptions,
        FaceDetector, FaceDetectorOptions,
        FaceLandmarker, FaceLandmarkerOptions,
        RunningMode,
    )

    video_path = str(args.get("videoPath") or "").strip()
    output_path = str(args.get("outputPath") or "").strip() or None
    task = str(args.get("task") or "pose").strip().lower()
    draw = bool(args.get("drawLandmarks", True))
    max_frames = int(args.get("maxFrames", 0))
    sample_n = max(1, int(args.get("sampleEveryN", 1)))
    min_det = float(args.get("minDetectionConfidence", 0.5))

    if not video_path:
        return {"ok": False, "error": "videoPath is required"}

    valid_tasks = ["pose", "hands", "face_detection", "face_mesh"]
    if task not in valid_tasks:
        return {"ok": False, "error": f"task must be one of: {valid_tasks}"}

    if emit:
        await emit("mediapipe_processing", {"task": f"video_{task}", "videoPath": video_path})

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"ok": False, "error": f"Cannot open video: {video_path}"}

    fps = cap.get(cv2.CAP_PROP_FPS)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    writer = None
    if draw:
        if not output_path:
            output_path = os.path.join(_get_output_dir(), f"mp_video_{uuid.uuid4().hex[:8]}.mp4")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(output_path, fourcc, fps, (w, h))

    # Build processor based on task
    processor: Any = None
    draw_conns: Any = None
    draw_color = (0, 255, 0)

    if task == "pose":
        model = await asyncio.to_thread(_get_model_path, "pose_landmarker")
        processor = PoseLandmarker.create_from_options(PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model),
            running_mode=RunningMode.VIDEO, num_poses=1,
            min_pose_detection_confidence=min_det,
        ))
        draw_conns = _get_pose_connections()
    elif task == "hands":
        model = await asyncio.to_thread(_get_model_path, "hand_landmarker")
        processor = HandLandmarker.create_from_options(HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model),
            running_mode=RunningMode.VIDEO, num_hands=2,
            min_hand_detection_confidence=min_det,
        ))
        draw_conns = _get_hand_connections()
        draw_color = (255, 0, 0)
    elif task == "face_detection":
        model = await asyncio.to_thread(_get_model_path, "face_detector")
        processor = FaceDetector.create_from_options(FaceDetectorOptions(
            base_options=BaseOptions(model_asset_path=model),
            running_mode=RunningMode.VIDEO,
            min_detection_confidence=min_det,
        ))
    elif task == "face_mesh":
        model = await asyncio.to_thread(_get_model_path, "face_landmarker")
        processor = FaceLandmarker.create_from_options(FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model),
            running_mode=RunningMode.VIDEO, num_faces=1,
            min_face_detection_confidence=min_det,
        ))
        draw_conns = _get_face_connections()
        draw_color = (0, 200, 200)

    frame_landmarks: list = []
    frame_idx = 0
    processed = 0
    detected_count = 0

    try:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            if max_frames > 0 and processed >= max_frames:
                break

            frame_idx += 1
            if frame_idx % sample_n != 0:
                if writer:
                    writer.write(frame)
                continue

            processed += 1
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            ts_ms = int(frame_idx * 1000 / fps)

            frame_data: Dict[str, Any] = {"frame": frame_idx, "timestamp": round(frame_idx / fps, 3)}
            has_detection = False

            if task == "pose":
                result = processor.detect_for_video(mp_image, ts_ms)
                if result.pose_landmarks:
                    has_detection = True
                    frame_data["landmarks"] = _nml_to_list(result.pose_landmarks[0], w, h)
                    if writer and draw:
                        _draw_landmarks_on_image(frame, result.pose_landmarks[0], draw_conns, draw_color)
            elif task == "hands":
                result = processor.detect_for_video(mp_image, ts_ms)
                if result.hand_landmarks:
                    has_detection = True
                    hands_d = [_nml_to_list(hl, w, h) for hl in result.hand_landmarks]
                    frame_data["hands"] = hands_d
                    if writer and draw:
                        for hl in result.hand_landmarks:
                            _draw_landmarks_on_image(frame, hl, draw_conns, draw_color)
            elif task == "face_detection":
                result = processor.detect_for_video(mp_image, ts_ms)
                if result.detections:
                    has_detection = True
                    fd_list = []
                    for det in result.detections:
                        bb = det.bounding_box
                        score = det.categories[0].score if det.categories else 0
                        fd_list.append({"bbox": {"x": round(bb.origin_x / w, 6), "y": round(bb.origin_y / h, 6),
                                                 "width": round(bb.width / w, 6), "height": round(bb.height / h, 6)},
                                        "confidence": round(score, 4)})
                    frame_data["faces"] = fd_list
                    if writer and draw:
                        _draw_bboxes_on_image(frame, result.detections)
            elif task == "face_mesh":
                result = processor.detect_for_video(mp_image, ts_ms)
                if result.face_landmarks:
                    has_detection = True
                    for face_lms in result.face_landmarks:
                        frame_data.setdefault("faces", []).append(_nml_to_list(face_lms, w, h))
                        if writer and draw:
                            _draw_landmarks_on_image(frame, face_lms, draw_conns, draw_color, thickness=1, radius=1)

            if has_detection:
                detected_count += 1
            frame_landmarks.append(frame_data)
            if writer:
                writer.write(frame)
            if emit and processed % 30 == 0:
                await emit("mediapipe_progress", {"processed": processed, "total": total_frames, "detected": detected_count})
    finally:
        cap.release()
        if writer:
            writer.release()
        if processor:
            processor.close()

    return {
        "ok": True,
        "frameCount": frame_idx,
        "processedFrames": processed,
        "framesWithDetection": detected_count,
        "outputPath": output_path if draw else None,
        "frameLandmarks": frame_landmarks,
    }
