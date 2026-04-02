import asyncio
import threading

import pytest

from app.tools import media as media_tools
from app.tools import screen_capture


@pytest.fixture(autouse=True)
def _clear_capture_registries():
    yield
    with media_tools._sessions_lock:
        media_tools._active_sessions.clear()
        media_tools._active_recordings.clear()
    with screen_capture._sessions_lock:
        screen_capture._active_screen_sessions.clear()
        screen_capture._active_screen_recordings.clear()
        screen_capture._active_audio_sessions.clear()
        screen_capture._active_audio_recordings.clear()


def test_stop_system_audio_clears_active_session():
    session_id = "system-audio-stop"
    stop_event = threading.Event()

    with screen_capture._sessions_lock:
        screen_capture._active_audio_sessions[session_id] = stop_event
        screen_capture._active_audio_recordings[session_id] = {
            "path": "C:/tmp/system-audio.wav",
            "completed": True,
            "error": None,
        }

    result = asyncio.run(screen_capture.stop_system_audio({"sessionId": session_id}))

    assert result["ok"] is True
    assert result["sessionId"] == session_id
    assert result["wasActive"] is True
    assert result["filePath"] == "C:/tmp/system-audio.wav"
    assert stop_event.is_set() is True

    with screen_capture._sessions_lock:
        assert session_id not in screen_capture._active_audio_sessions
        assert session_id not in screen_capture._active_audio_recordings


def test_stop_capture_delegates_to_system_audio_session():
    session_id = "delegated-system-audio"
    stop_event = threading.Event()

    with screen_capture._sessions_lock:
        screen_capture._active_audio_sessions[session_id] = stop_event
        screen_capture._active_audio_recordings[session_id] = {
            "path": "C:/tmp/delegated-system-audio.wav",
            "completed": True,
            "error": None,
        }

    result = asyncio.run(media_tools.stop_capture({"sessionId": session_id}))

    assert result["ok"] is True
    assert result["sessionId"] == session_id
    assert result["wasActive"] is True
    assert result["filePath"] == "C:/tmp/delegated-system-audio.wav"
    assert stop_event.is_set() is True

    with screen_capture._sessions_lock:
        assert session_id not in screen_capture._active_audio_sessions
        assert session_id not in screen_capture._active_audio_recordings


def test_capture_system_audio_passes_requested_device_to_worker(monkeypatch: pytest.MonkeyPatch):
    captured: dict[str, str] = {}

    def fake_worker(
        path: str,
        duration_ms: int,
        stop_event: threading.Event,
        session_id: str,
        emit=None,
        loop=None,
        recording_info=None,
        silence_threshold: float = 0.01,
        silence_duration_ms: int = 2000,
        stream_id=None,
        device=None,
    ) -> None:
        captured["device"] = str(device)
        captured["session_id"] = session_id
        if recording_info is not None:
            recording_info["completed"] = True
        with screen_capture._sessions_lock:
            screen_capture._active_audio_sessions.pop(session_id, None)

    class ImmediateThread:
        def __init__(self, target=None, args=(), kwargs=None, daemon=None):
            self._target = target
            self._args = args
            self._kwargs = kwargs or {}

        def start(self):
            if self._target:
                self._target(*self._args, **self._kwargs)

    monkeypatch.setattr(screen_capture, "_capture_system_audio_worker", fake_worker)
    monkeypatch.setattr(screen_capture.threading, "Thread", ImmediateThread)

    result = asyncio.run(
        screen_capture.capture_system_audio(
            {
                "mode": "until_stop",
                "sessionId": "requested-device-session",
                "device": "Loopback Output A",
            }
        )
    )

    assert result["ok"] is True
    assert result["sessionId"] == "requested-device-session"
    assert captured["session_id"] == "requested-device-session"
    assert captured["device"] == "Loopback Output A"
