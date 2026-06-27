"""
Standalone MediaPipe HTTP service.

Wraps mediapipe vision tools (pose, hands, face, segmentation) behind a
lightweight aiohttp server so the desktop app can spawn it as a packaged
binary — no Python, pip, or venv needed on the user's machine.

Port: STUARD_MEDIAPIPE_PORT (default 18083)
Auth: STUARD_MEDIAPIPE_AUTH_TOKEN header check (optional)
"""

from __future__ import annotations

import asyncio
import base64
import hmac
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.request import urlretrieve

from aiohttp import web

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

PORT = int(os.environ.get("STUARD_MEDIAPIPE_PORT", "18083"))
HOST = os.environ.get("STUARD_MEDIAPIPE_HOST", "127.0.0.1")
AUTH_HEADER = "x-stuard-mediapipe-token"
AUTH_TOKEN = os.environ.get("STUARD_MEDIAPIPE_AUTH_TOKEN", "").strip()

# ---------------------------------------------------------------------------
# Model management
# ---------------------------------------------------------------------------

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
    url = _MODEL_URLS[model_key]
    filename = url.rsplit("/", 1)[-1]
    local = os.path.join(_models_dir(), filename)
    if not os.path.isfile(local):
        print(f"[mediapipe-service] Downloading model {model_key}: {filename}", flush=True)
        urlretrieve(url, local)
        print(f"[mediapipe-service] Downloaded {filename}", flush=True)
    return local


def _output_dir() -> str:
    d = os.path.join(os.path.expanduser("~"), "StuardAI", "mediapipe")
    os.makedirs(d, exist_ok=True)
    return d


# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------

def _load_image_from_b64(data_url: str):
    import cv2
    import numpy as np
    if "," in data_url:
        b64_str = data_url.split(",", 1)[1]
    else:
        b64_str = data_url
    raw = base64.b64decode(b64_str)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode image data")
    return img


def _load_image_from_path(path: str):
    import cv2
    img = cv2.imread(path)
    if img is None:
        raise FileNotFoundError(f"Cannot read image: {path}")
    return img


def _encode_image(img, quality: int = 80) -> str:
    import cv2
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("JPEG encode failed")
    return f"data:image/jpeg;base64,{base64.b64encode(buf.tobytes()).decode('ascii')}"


def _resolve_image_sync(body: dict):
    image_data = str(body.get("imageData") or "").strip()
    image_path = str(body.get("imagePath") or "").strip()
    if image_data and image_data.startswith("data:"):
        return _load_image_from_b64(image_data)
    if image_path:
        return _load_image_from_path(image_path)
    raise ValueError("imageData or imagePath is required")


def _nml_to_list(landmarks, w: int = 0, h: int = 0):
    result = []
    for i, lm in enumerate(landmarks):
        entry: Dict[str, Any] = {"index": i, "x": round(lm.x, 6), "y": round(lm.y, 6), "z": round(lm.z, 6)}
        if hasattr(lm, "visibility") and lm.visibility is not None:
            entry["visibility"] = round(lm.visibility, 4)
        if w and h:
            entry["px_x"] = int(lm.x * w)
            entry["px_y"] = int(lm.y * h)
        result.append(entry)
    return result


# ---------------------------------------------------------------------------
# JSON helpers
# ---------------------------------------------------------------------------

def _ok(data: dict) -> web.Response:
    return web.json_response({"ok": True, **data})


def _err(msg: str, status: int = 400) -> web.Response:
    return web.json_response({"ok": False, "error": msg}, status=status)


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

async def handle_status(req: web.Request) -> web.Response:
    try:
        import mediapipe as mp
        import cv2
        import numpy
        version = getattr(mp, "__version__", "unknown")
        return _ok({"available": True, "version": version, "cv2": cv2.__version__, "numpy": numpy.__version__})
    except ImportError as e:
        return _ok({"available": False, "error": str(e)})


async def handle_models(req: web.Request) -> web.Response:
    """List available models and their download status."""
    models = {}
    for key, url in _MODEL_URLS.items():
        filename = url.rsplit("/", 1)[-1]
        local = os.path.join(_models_dir(), filename)
        models[key] = {"filename": filename, "downloaded": os.path.isfile(local)}
    return _ok({"models": models})


async def handle_pose(req: web.Request) -> web.Response:
    body = await req.json()
    try:
        import mediapipe as mp
        import cv2

        img = await asyncio.to_thread(_resolve_image_sync, body)
        h, w = img.shape[:2]
        draw = body.get("draw", False)
        model_path = _get_model_path("pose_landmarker")

        def run():
            from mediapipe.tasks.python import vision as mp_vision, BaseOptions
            options = mp_vision.PoseLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=model_path),
                num_poses=int(body.get("maxPoses", 1)),
                output_segmentation_masks=False,
            )
            landmarker = mp_vision.PoseLandmarker.create_from_options(options)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            result = landmarker.detect(mp_image)
            landmarker.close()

            poses = []
            for landmarks in result.pose_landmarks:
                poses.append(_nml_to_list(landmarks, w, h))

            annotated = None
            if draw and poses:
                from mediapipe import solutions as mp_solutions
                annotated = img.copy()
                for pose_landmarks in result.pose_landmarks:
                    mp_solutions.drawing_utils.draw_landmarks(
                        annotated,
                        pose_landmarks,
                        mp_solutions.pose.POSE_CONNECTIONS,
                    )

            return poses, annotated

        poses, annotated = await asyncio.to_thread(run)
        resp: Dict[str, Any] = {"poses": poses, "count": len(poses), "width": w, "height": h}
        if annotated is not None:
            resp["annotatedImage"] = _encode_image(annotated)
        return _ok(resp)
    except Exception as e:
        return _err(f"Pose detection failed: {e}", 500)


async def handle_hands(req: web.Request) -> web.Response:
    body = await req.json()
    try:
        import mediapipe as mp
        import cv2

        img = await asyncio.to_thread(_resolve_image_sync, body)
        h, w = img.shape[:2]
        draw = body.get("draw", False)
        model_path = _get_model_path("hand_landmarker")

        def run():
            from mediapipe.tasks.python import vision as mp_vision, BaseOptions
            options = mp_vision.HandLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=model_path),
                num_hands=int(body.get("maxHands", 2)),
            )
            landmarker = mp_vision.HandLandmarker.create_from_options(options)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            result = landmarker.detect(mp_image)
            landmarker.close()

            hands = []
            handedness_list = []
            for i, landmarks in enumerate(result.hand_landmarks):
                hands.append(_nml_to_list(landmarks, w, h))
                if i < len(result.handedness):
                    cat = result.handedness[i]
                    handedness_list.append(cat[0].category_name if cat else "Unknown")

            annotated = None
            if draw and hands:
                from mediapipe import solutions as mp_solutions
                annotated = img.copy()
                for hand_landmarks in result.hand_landmarks:
                    mp_solutions.drawing_utils.draw_landmarks(
                        annotated,
                        hand_landmarks,
                        mp_solutions.hands.HAND_CONNECTIONS,
                    )

            return hands, handedness_list, annotated

        hands, handedness, annotated = await asyncio.to_thread(run)
        resp: Dict[str, Any] = {"hands": hands, "handedness": handedness, "count": len(hands), "width": w, "height": h}
        if annotated is not None:
            resp["annotatedImage"] = _encode_image(annotated)
        return _ok(resp)
    except Exception as e:
        return _err(f"Hand detection failed: {e}", 500)


async def handle_face_detection(req: web.Request) -> web.Response:
    body = await req.json()
    try:
        import mediapipe as mp
        import cv2

        img = await asyncio.to_thread(_resolve_image_sync, body)
        h, w = img.shape[:2]
        draw = body.get("draw", False)
        model_path = _get_model_path("face_detector")

        def run():
            from mediapipe.tasks.python import vision as mp_vision, BaseOptions
            options = mp_vision.FaceDetectorOptions(
                base_options=BaseOptions(model_asset_path=model_path),
            )
            detector = mp_vision.FaceDetector.create_from_options(options)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            result = detector.detect(mp_image)
            detector.close()

            faces = []
            for detection in result.detections:
                bb = detection.bounding_box
                face: Dict[str, Any] = {
                    "x": bb.origin_x,
                    "y": bb.origin_y,
                    "width": bb.width,
                    "height": bb.height,
                }
                if detection.categories:
                    face["confidence"] = round(detection.categories[0].score, 4)
                faces.append(face)

            annotated = None
            if draw and faces:
                annotated = img.copy()
                for f in faces:
                    x1, y1 = f["x"], f["y"]
                    x2, y2 = x1 + f["width"], y1 + f["height"]
                    cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), 2)

            return faces, annotated

        faces, annotated = await asyncio.to_thread(run)
        resp: Dict[str, Any] = {"faces": faces, "count": len(faces), "width": w, "height": h}
        if annotated is not None:
            resp["annotatedImage"] = _encode_image(annotated)
        return _ok(resp)
    except Exception as e:
        return _err(f"Face detection failed: {e}", 500)


async def handle_face_mesh(req: web.Request) -> web.Response:
    body = await req.json()
    try:
        import mediapipe as mp
        import cv2

        img = await asyncio.to_thread(_resolve_image_sync, body)
        h, w = img.shape[:2]
        draw = body.get("draw", False)
        model_path = _get_model_path("face_landmarker")

        def run():
            from mediapipe.tasks.python import vision as mp_vision, BaseOptions
            options = mp_vision.FaceLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=model_path),
                num_faces=int(body.get("maxFaces", 1)),
                output_face_blendshapes=bool(body.get("blendshapes", False)),
            )
            landmarker = mp_vision.FaceLandmarker.create_from_options(options)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            result = landmarker.detect(mp_image)
            landmarker.close()

            faces = []
            for landmarks in result.face_landmarks:
                faces.append(_nml_to_list(landmarks, w, h))

            blendshapes = []
            if hasattr(result, "face_blendshapes") and result.face_blendshapes:
                for face_bs in result.face_blendshapes:
                    blendshapes.append([
                        {"name": bs.category_name, "score": round(bs.score, 4)}
                        for bs in face_bs
                    ])

            annotated = None
            if draw and faces:
                from mediapipe import solutions as mp_solutions
                annotated = img.copy()
                for face_landmarks in result.face_landmarks:
                    mp_solutions.drawing_utils.draw_landmarks(
                        annotated,
                        face_landmarks,
                        mp_solutions.face_mesh.FACEMESH_TESSELATION,
                        landmark_drawing_spec=None,
                        connection_drawing_spec=mp_solutions.drawing_styles.get_default_face_mesh_tesselation_style(),
                    )

            return faces, blendshapes, annotated

        faces, blendshapes, annotated = await asyncio.to_thread(run)
        resp: Dict[str, Any] = {"faces": faces, "count": len(faces), "width": w, "height": h}
        if blendshapes:
            resp["blendshapes"] = blendshapes
        if annotated is not None:
            resp["annotatedImage"] = _encode_image(annotated)
        return _ok(resp)
    except Exception as e:
        return _err(f"Face mesh failed: {e}", 500)


async def handle_segmentation(req: web.Request) -> web.Response:
    body = await req.json()
    try:
        import mediapipe as mp
        import cv2
        import numpy as np

        img = await asyncio.to_thread(_resolve_image_sync, body)
        h, w = img.shape[:2]
        model_path = _get_model_path("image_segmenter")
        bg_color_hex = str(body.get("backgroundColor", "#00FF00")).strip()

        def run():
            from mediapipe.tasks.python import vision as mp_vision, BaseOptions
            options = mp_vision.ImageSegmenterOptions(
                base_options=BaseOptions(model_asset_path=model_path),
                output_category_mask=True,
            )
            segmenter = mp_vision.ImageSegmenter.create_from_options(options)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            result = segmenter.segment(mp_image)
            segmenter.close()

            mask = result.category_mask.numpy_view() if result.category_mask else None
            if mask is None:
                return img, None

            # Parse background color
            hex_clean = bg_color_hex.lstrip("#")
            if len(hex_clean) == 6:
                r, g, b = int(hex_clean[:2], 16), int(hex_clean[2:4], 16), int(hex_clean[4:6], 16)
            else:
                r, g, b = 0, 255, 0

            fg_mask = (mask > 0).astype(np.uint8)
            bg = np.full_like(img, (b, g, r), dtype=np.uint8)
            fg_mask_3ch = np.stack([fg_mask] * 3, axis=-1)
            composite = np.where(fg_mask_3ch, img, bg)
            return composite, fg_mask

        composite, mask = await asyncio.to_thread(run)
        resp: Dict[str, Any] = {"width": w, "height": h, "segmentedImage": _encode_image(composite)}
        return _ok(resp)
    except Exception as e:
        return _err(f"Segmentation failed: {e}", 500)


# ---------------------------------------------------------------------------
# Auth middleware
# ---------------------------------------------------------------------------

@web.middleware
async def auth_middleware(req: web.Request, handler):
    if not AUTH_TOKEN:
        return await handler(req)
    incoming = str(req.headers.get(AUTH_HEADER, "")).strip()
    if not incoming or not hmac.compare_digest(incoming, AUTH_TOKEN):
        return web.json_response({"ok": False, "error": "unauthorized"}, status=401)
    return await handler(req)


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

def create_app() -> web.Application:
    app = web.Application(middlewares=[auth_middleware])
    app.router.add_get("/status", handle_status)
    app.router.add_get("/models", handle_models)
    app.router.add_post("/pose", handle_pose)
    app.router.add_post("/hands", handle_hands)
    app.router.add_post("/face_detection", handle_face_detection)
    app.router.add_post("/face_mesh", handle_face_mesh)
    app.router.add_post("/segmentation", handle_segmentation)
    return app


def main():
    app = create_app()
    print(f"[mediapipe-service] Starting on {HOST}:{PORT}", flush=True)
    web.run_app(app, host=HOST, port=PORT, print=lambda msg: print(msg, flush=True))


if __name__ == "__main__":
    main()
