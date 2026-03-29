"""
Tests for the wakeword detection module.

Covers:
  - NumPyDS_CNN model loading and validation
  - Model prediction with various inputs
  - Audio preprocessing (mono conversion, resampling)
  - Buffer tuple unpacking (media_bus 4-element tuples)
  - _WakewordService lifecycle (init, start, stop)
  - _run loop with mock bus data
  - wakeword_start / wakeword_stop / wakeword_status async API
  - Error handling for corrupted weights, missing keys, etc.
"""

import asyncio
import collections
import os
import sys
import tempfile
import threading
import time

import numpy as np
import pytest

# Ensure the agent app package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.tools.wakeword import (
    INPUT_LEN,
    SAMPLE_RATE,
    NumPyDS_CNN,
    _WakewordConfig,
    _WakewordService,
    _default_weights_path,
    _resample_linear,
    _to_mono,
)
from app.tools import media_bus


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

WEIGHTS_PATH = os.path.join(
    os.path.dirname(__file__), "..", "app", "data", "wakeword", "kws_weights.npz"
)


@pytest.fixture
def weights_path():
    path = os.path.abspath(WEIGHTS_PATH)
    if not os.path.exists(path):
        pytest.skip("Weights file not found")
    return path


@pytest.fixture
def model(weights_path):
    return NumPyDS_CNN(weights_path)


@pytest.fixture
def event_loop_thread():
    """Provide a background event loop for testing async code from sync threads."""
    loop = asyncio.new_event_loop()
    t = threading.Thread(target=loop.run_forever, daemon=True)
    t.start()
    yield loop
    loop.call_soon_threadsafe(loop.stop)
    t.join(timeout=3)
    loop.close()


@pytest.fixture
def default_config(weights_path):
    return _WakewordConfig(
        sensitivity=0.7,
        cooldown_s=1.0,
        device=None,
        weights_path=weights_path,
        trigger_count=4,
        ema_alpha=0.2,
    )


# ---------------------------------------------------------------------------
# NumPyDS_CNN — Loading & Validation
# ---------------------------------------------------------------------------


class TestNumPyDSCNNLoading:
    def test_load_valid_weights(self, weights_path):
        model = NumPyDS_CNN(weights_path)
        assert model.mel_matrix is not None
        assert model.window is not None
        assert len(model.layers) == 10  # 1 conv + 4 DS blocks (2 each) + 1 dense

    def test_load_missing_file_raises(self):
        with pytest.raises(ValueError, match="Failed to load weights"):
            NumPyDS_CNN("/nonexistent/path/weights.npz")

    def test_load_corrupted_file_raises(self):
        with tempfile.NamedTemporaryFile(suffix=".npz", delete=False) as f:
            f.write(b"not a valid npz file")
            f.flush()
            path = f.name
        try:
            with pytest.raises(ValueError, match="Failed to load weights"):
                NumPyDS_CNN(path)
        finally:
            os.unlink(path)

    def test_load_missing_keys_raises(self):
        """Weights file with wrong keys should fail validation."""
        path = os.path.join(tempfile.gettempdir(), "test_bad_keys.npz")
        np.savez(path, dummy=np.zeros(1))
        try:
            with pytest.raises(ValueError, match="missing required keys"):
                NumPyDS_CNN(path)
        finally:
            os.unlink(path)

    def test_weight_shapes(self, model):
        """Verify expected shapes of loaded weights."""
        assert model.mel_matrix.shape == (257, 40)
        assert model.window.shape == (480,)
        assert model.window.dtype == np.float32

    def test_layer_count_and_types(self, model):
        types = [layer[0] for layer in model.layers]
        assert types[0] == "conv"
        assert types[-1] == "dense"
        assert types.count("dw_conv") == 4
        assert types.count("conv") == 5  # 1 initial + 4 pointwise


# ---------------------------------------------------------------------------
# NumPyDS_CNN — Prediction
# ---------------------------------------------------------------------------


class TestNumPyDSCNNPrediction:
    def test_predict_returns_float(self, model):
        audio = np.zeros(INPUT_LEN, dtype=np.float32)
        score = model.predict(audio)
        assert isinstance(score, float)

    def test_predict_score_range(self, model):
        """Score should be between 0 and 1 (softmax output)."""
        audio = np.random.randn(INPUT_LEN).astype(np.float32) * 0.1
        score = model.predict(audio)
        assert 0.0 <= score <= 1.0

    def test_predict_zeros_low_score(self, model):
        """Silence should produce a low wake-word score."""
        audio = np.zeros(INPUT_LEN, dtype=np.float32)
        score = model.predict(audio)
        assert score < 0.1

    def test_predict_random_noise_low_score(self, model):
        """Random noise should generally produce a low score."""
        audio = np.random.randn(INPUT_LEN).astype(np.float32) * 0.01
        score = model.predict(audio)
        assert score < 0.5

    def test_predict_short_audio_padded(self, model):
        """Audio shorter than INPUT_LEN should be zero-padded and still work."""
        short_audio = np.random.randn(INPUT_LEN // 2).astype(np.float32) * 0.01
        score = model.predict(short_audio)
        assert 0.0 <= score <= 1.0

    def test_predict_long_audio_truncated(self, model):
        """Audio longer than INPUT_LEN should be truncated and still work."""
        long_audio = np.random.randn(INPUT_LEN * 2).astype(np.float32) * 0.01
        score = model.predict(long_audio)
        assert 0.0 <= score <= 1.0

    def test_predict_deterministic(self, model):
        """Same input should produce same output."""
        audio = np.random.RandomState(42).randn(INPUT_LEN).astype(np.float32)
        s1 = model.predict(audio)
        s2 = model.predict(audio)
        assert s1 == s2

    def test_predict_many_times_no_crash(self, model):
        """Run many predictions to catch intermittent crashes."""
        for _ in range(100):
            audio = np.random.randn(INPUT_LEN).astype(np.float32) * 0.05
            score = model.predict(audio)
            assert 0.0 <= score <= 1.0


# ---------------------------------------------------------------------------
# Audio Utilities
# ---------------------------------------------------------------------------


class TestAudioUtils:
    def test_to_mono_1d(self):
        audio = np.random.randn(1000).astype(np.float32)
        result = _to_mono(audio)
        assert result.ndim == 1
        assert result.dtype == np.float32

    def test_to_mono_2d_single_channel(self):
        audio = np.random.randn(1000, 1).astype(np.float32)
        result = _to_mono(audio)
        assert result.ndim == 1
        assert result.shape[0] == 1000

    def test_to_mono_2d_stereo(self):
        audio = np.random.randn(1000, 2).astype(np.float32)
        result = _to_mono(audio)
        assert result.ndim == 1
        assert result.shape[0] == 1000

    def test_resample_same_rate(self):
        audio = np.random.randn(16000).astype(np.float32)
        result = _resample_linear(audio, sr_in=16000, sr_out=16000)
        np.testing.assert_array_equal(result, audio)

    def test_resample_downsample(self):
        audio = np.random.randn(44100).astype(np.float32)
        result = _resample_linear(audio, sr_in=44100, sr_out=16000)
        expected_len = round(44100 * (16000 / 44100))
        assert result.shape[0] == expected_len

    def test_resample_upsample(self):
        audio = np.random.randn(8000).astype(np.float32)
        result = _resample_linear(audio, sr_in=8000, sr_out=16000)
        expected_len = round(8000 * (16000 / 8000))
        assert result.shape[0] == expected_len

    def test_resample_empty(self):
        audio = np.zeros(0, dtype=np.float32)
        result = _resample_linear(audio, sr_in=44100, sr_out=16000)
        assert result.size == 0

    def test_resample_single_sample(self):
        audio = np.array([0.5], dtype=np.float32)
        result = _resample_linear(audio, sr_in=44100, sr_out=16000)
        assert result.size == 0  # single sample can't be interpolated


# ---------------------------------------------------------------------------
# Buffer Tuple Unpacking (media_bus compatibility)
# ---------------------------------------------------------------------------


class TestBufferUnpacking:
    """Verify wakeword code handles 4-element tuples from media_bus."""

    def test_unpack_4_element_tuples(self):
        """media_bus.py stores (index, chunk, timestamp, rms) — 4 elements."""
        buffer = collections.deque(maxlen=300)
        for i in range(5):
            chunk = np.random.randn(4410).astype(np.float32)
            rms = float(np.sqrt(np.mean(chunk**2)))
            buffer.append((i, chunk, time.time(), rms))

        snap = list(buffer)

        # This is the pattern used in _run:
        for entry in snap:
            idx, data, _ts = entry[0], entry[1], entry[2]
            assert isinstance(idx, int)
            assert isinstance(data, np.ndarray)
            assert isinstance(_ts, float)

    def test_unpack_3_element_tuples(self):
        """Backwards compat: should also work if bus only has 3 elements."""
        buffer = collections.deque(maxlen=300)
        for i in range(5):
            chunk = np.random.randn(4410).astype(np.float32)
            buffer.append((i, chunk, time.time()))

        snap = list(buffer)
        for entry in snap:
            idx, data, _ts = entry[0], entry[1], entry[2]
            assert isinstance(idx, int)
            assert isinstance(data, np.ndarray)


# ---------------------------------------------------------------------------
# _WakewordService — Lifecycle
# ---------------------------------------------------------------------------


class TestWakewordService:
    def test_init_loads_model(self, default_config, event_loop_thread):
        svc = _WakewordService(default_config, event_loop_thread)
        assert svc._model is not None
        assert svc.last_error is None

    def test_init_bad_weights_sets_model_none(self, event_loop_thread):
        cfg = _WakewordConfig(
            sensitivity=0.7,
            cooldown_s=1.0,
            device=None,
            weights_path="/nonexistent/weights.npz",
            trigger_count=4,
            ema_alpha=0.2,
        )
        svc = _WakewordService(cfg, event_loop_thread)
        assert svc._model is None
        assert svc.last_error is not None
        assert "model_load_failed" in svc.last_error

    def test_start_stop(self, default_config, event_loop_thread):
        svc = _WakewordService(default_config, event_loop_thread)
        svc.start()
        assert svc.thread is not None
        assert svc.thread.is_alive()

        svc.stop()
        time.sleep(0.5)
        assert not svc.thread.is_alive()

    def test_start_idempotent(self, default_config, event_loop_thread):
        svc = _WakewordService(default_config, event_loop_thread)
        svc.start()
        t1 = svc.thread
        svc.start()  # should not create a new thread
        assert svc.thread is t1
        svc.stop()

    def test_update_config_keeps_old_model_on_failure(self, default_config, event_loop_thread):
        svc = _WakewordService(default_config, event_loop_thread)
        old_model = svc._model
        assert old_model is not None

        bad_cfg = _WakewordConfig(
            sensitivity=0.5,
            cooldown_s=2.0,
            device=None,
            weights_path="/nonexistent/weights.npz",
            trigger_count=3,
            ema_alpha=0.1,
        )
        svc.update_config(bad_cfg)

        assert svc._model is old_model  # old model preserved
        assert svc.last_error is not None
        assert svc.cfg.sensitivity == 0.5  # config was updated

    def test_run_with_mock_bus(self, default_config, event_loop_thread):
        """_run processes mock bus data without crashing."""
        svc = _WakewordService(default_config, event_loop_thread)

        # Create a fake bus
        class FakeBus:
            def __init__(self):
                self.samplerate = 44100
                self.buffer = collections.deque(maxlen=300)
                self.buffer_lock = threading.Lock()
                for i in range(10):
                    chunk = np.random.randn(4410).astype(np.float32) * 0.01
                    rms = float(np.sqrt(np.mean(chunk**2)))
                    self.buffer.append((i, chunk, time.time(), rms))

        fake_bus = FakeBus()
        bus_key = media_bus._bus_key("audio", None)

        with media_bus._buses_lock:
            media_bus._buses[bus_key] = fake_bus

        try:
            svc.start()
            time.sleep(2)
            svc.stop()

            assert svc.last_score is not None
            assert svc.last_error is None
            assert svc.last_infer_ms is not None
            assert svc.last_infer_ms > 0
        finally:
            with media_bus._buses_lock:
                media_bus._buses.pop(bus_key, None)

    def test_run_no_bus_does_not_crash(self, default_config, event_loop_thread):
        """_run should handle missing bus gracefully."""
        svc = _WakewordService(default_config, event_loop_thread)
        svc.start()
        time.sleep(0.5)
        svc.stop()
        # No crash = pass
        assert svc.last_error is None

    def test_run_none_model_sleeps(self, event_loop_thread):
        """_run should sleep when model is None, not crash."""
        cfg = _WakewordConfig(
            sensitivity=0.7,
            cooldown_s=1.0,
            device=None,
            weights_path="/nonexistent/weights.npz",
            trigger_count=4,
            ema_alpha=0.2,
        )
        svc = _WakewordService(cfg, event_loop_thread)
        assert svc._model is None

        svc.start()
        time.sleep(1)
        svc.stop()
        # Thread ran without crashing even with None model
        assert not svc.thread.is_alive()

    def test_model_lock_thread_safety(self, default_config, event_loop_thread):
        """Concurrent model access should not crash."""
        svc = _WakewordService(default_config, event_loop_thread)

        errors = []

        def swap_model():
            for _ in range(50):
                try:
                    new_model = NumPyDS_CNN(default_config.weights_path)
                    with svc._model_lock:
                        svc._model = new_model
                except Exception as e:
                    errors.append(e)
                time.sleep(0.01)

        def read_model():
            for _ in range(50):
                try:
                    with svc._model_lock:
                        m = svc._model
                    if m is not None:
                        audio = np.zeros(INPUT_LEN, dtype=np.float32)
                        m.predict(audio)
                except Exception as e:
                    errors.append(e)
                time.sleep(0.01)

        t1 = threading.Thread(target=swap_model)
        t2 = threading.Thread(target=read_model)
        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)

        assert len(errors) == 0, f"Thread safety errors: {errors}"


# ---------------------------------------------------------------------------
# Async API — wakeword_start / wakeword_stop / wakeword_status
# ---------------------------------------------------------------------------


class TestWakewordAsyncAPI:
    @pytest.fixture(autouse=True)
    def _reset_service(self):
        """Ensure no lingering service between tests."""
        import app.tools.wakeword as wk
        yield
        # Force cleanup
        if wk._service:
            wk._service.stop_event.set()
            if wk._service.thread:
                wk._service.thread.join(timeout=2)
            wk._service = None

    def test_start_missing_weights_falls_back_to_default(self):
        """When an invalid weightsPath is given, wakeword_start falls back to
        the default packaged weights (which exist) and succeeds."""
        from app.tools.wakeword import wakeword_start, wakeword_stop, _default_weights_path

        default_exists = os.path.exists(_default_weights_path())

        async def run():
            result = await wakeword_start({
                "weightsPath": "/definitely/not/a/real/path.npz",
            })
            if result.get("ok"):
                await wakeword_stop({})
            return result

        result = asyncio.get_event_loop().run_until_complete(run())
        if default_exists:
            # Falls back to default weights — should succeed
            assert result["ok"] is True
        else:
            assert result["ok"] is False

    def test_status_when_not_running(self):
        from app.tools.wakeword import wakeword_status

        async def run():
            return await wakeword_status({})

        result = asyncio.get_event_loop().run_until_complete(run())
        assert result["ok"] is True
        assert result["running"] is False

    def test_stop_when_not_running(self):
        from app.tools.wakeword import wakeword_stop

        async def run():
            return await wakeword_stop({})

        result = asyncio.get_event_loop().run_until_complete(run())
        assert result["ok"] is True
        assert result["running"] is False


# ---------------------------------------------------------------------------
# Default weights path resolution
# ---------------------------------------------------------------------------


class TestDefaultWeightsPath:
    def test_returns_string(self):
        path = _default_weights_path()
        assert isinstance(path, str)
        assert path.endswith("kws_weights.npz")

    def test_finds_existing_weights(self, weights_path):
        path = _default_weights_path()
        assert os.path.exists(path)


# ---------------------------------------------------------------------------
# _broadcast — event loop guard
# ---------------------------------------------------------------------------


class TestBroadcast:
    def test_broadcast_with_closed_loop(self, default_config):
        """_broadcast should not crash when the event loop is closed."""
        loop = asyncio.new_event_loop()
        loop.close()  # Close immediately

        svc = _WakewordService(default_config, loop)
        # Should not raise
        svc._broadcast("wakeword_detected", {"score": 0.9})
        # No assertion needed — not crashing is the test

    def test_broadcast_with_running_loop(self, default_config, event_loop_thread):
        """_broadcast should succeed with a running event loop."""
        svc = _WakewordService(default_config, event_loop_thread)
        # Should not raise (no connected websockets, but broadcast is fire-and-forget)
        svc._broadcast("wakeword_detected", {"score": 0.9})


# ---------------------------------------------------------------------------
# _run — circuit breaker & error handling
# ---------------------------------------------------------------------------


class TestRunCircuitBreaker:
    def test_circuit_breaker_stops_after_50_errors(self, default_config, event_loop_thread):
        """The _run loop should stop after 50 consecutive errors."""
        import unittest.mock as mock
        import app.tools.wakeword as wk_mod

        svc = _WakewordService(default_config, event_loop_thread)

        # Sabotage predict to always raise
        svc._model.predict = lambda audio: (_ for _ in ()).throw(RuntimeError("simulated predict error"))

        # Create a bus with valid data so buffer read succeeds but predict crashes
        class FakeBus:
            def __init__(self):
                self.samplerate = 16000
                self.buffer = collections.deque(maxlen=300)
                self.buffer_lock = threading.Lock()
                self._idx = 0
                self._stop = threading.Event()
                self._feeder = threading.Thread(target=self._feed, daemon=True)

            def _feed(self):
                while not self._stop.is_set():
                    chunk = np.random.randn(1600).astype(np.float32) * 0.01
                    with self.buffer_lock:
                        self.buffer.append((self._idx, chunk, time.time(), 0.01))
                        self._idx += 1
                    time.sleep(0.02)

            def start(self):
                self._feeder.start()

            def stop(self):
                self._stop.set()
                self._feeder.join(timeout=3)

        fake_bus = FakeBus()
        fake_bus.start()
        bus_key = media_bus._bus_key("audio", None)
        with media_bus._buses_lock:
            media_bus._buses[bus_key] = fake_bus

        try:
            # Patch time.sleep in the wakeword module to be near-instant
            with mock.patch.object(wk_mod.time, "sleep", side_effect=lambda _: None):
                svc.start()
                # With sleep patched to no-op, 50 errors should happen within seconds
                deadline = time.time() + 10
                while time.time() < deadline:
                    if svc.last_error and "too_many_errors" in svc.last_error:
                        break
                    time.sleep(0.1)  # real sleep in the test — just polling

            assert svc.last_error is not None
            assert "too_many_errors" in svc.last_error
        finally:
            svc.stop()
            fake_bus.stop()
            with media_bus._buses_lock:
                media_bus._buses.pop(bus_key, None)

    def test_errors_reset_on_successful_iteration(self, default_config, event_loop_thread):
        """Consecutive error count should reset after a successful iteration."""
        svc = _WakewordService(default_config, event_loop_thread)

        # Create a bus with valid data
        class FakeBus:
            def __init__(self):
                self.samplerate = 44100
                self.buffer = collections.deque(maxlen=300)
                self.buffer_lock = threading.Lock()
                for i in range(5):
                    chunk = np.random.randn(4410).astype(np.float32) * 0.01
                    rms = float(np.sqrt(np.mean(chunk**2)))
                    self.buffer.append((i, chunk, time.time(), rms))

        bus_key = media_bus._bus_key("audio", None)
        with media_bus._buses_lock:
            media_bus._buses[bus_key] = FakeBus()

        try:
            svc.start()
            time.sleep(2)
            svc.stop()

            # Should have processed successfully — no errors
            assert svc.last_error is None
            assert svc.last_score is not None
        finally:
            with media_bus._buses_lock:
                media_bus._buses.pop(bus_key, None)


# ---------------------------------------------------------------------------
# _run — EMA smoothing & trigger count
# ---------------------------------------------------------------------------


class TestEMASmoothing:
    def test_ema_disabled_when_alpha_zero(self, weights_path, event_loop_thread):
        """When ema_alpha=0.0, the raw score should be used as the decision."""
        cfg = _WakewordConfig(
            sensitivity=0.7,
            cooldown_s=1.0,
            device=None,
            weights_path=weights_path,
            trigger_count=1,
            ema_alpha=0.0,
        )
        svc = _WakewordService(cfg, event_loop_thread)

        class FakeBus:
            def __init__(self):
                self.samplerate = 44100
                self.buffer = collections.deque(maxlen=300)
                self.buffer_lock = threading.Lock()
                for i in range(5):
                    chunk = np.random.randn(4410).astype(np.float32) * 0.01
                    rms = float(np.sqrt(np.mean(chunk**2)))
                    self.buffer.append((i, chunk, time.time(), rms))

        bus_key = media_bus._bus_key("audio", None)
        with media_bus._buses_lock:
            media_bus._buses[bus_key] = FakeBus()

        try:
            svc.start()
            time.sleep(2)
            svc.stop()

            # With alpha=0, decision == score (no smoothing)
            assert svc.last_score is not None
            assert svc.last_decision is not None
            assert svc.last_score == svc.last_decision
        finally:
            with media_bus._buses_lock:
                media_bus._buses.pop(bus_key, None)


# ---------------------------------------------------------------------------
# BaseException catching in _run
# ---------------------------------------------------------------------------


class TestRunFatalExceptionHandling:
    def test_keyboard_interrupt_caught_in_run(self, default_config, event_loop_thread):
        """KeyboardInterrupt during processing should be caught by _run's BaseException handler."""
        svc = _WakewordService(default_config, event_loop_thread)

        # Sabotage predict to raise KeyboardInterrupt — simulates what happens if
        # the OS delivers Ctrl+C to the daemon thread.
        svc._model.predict = lambda audio: (_ for _ in ()).throw(KeyboardInterrupt("simulated"))

        class FakeBus:
            def __init__(self):
                self.samplerate = 16000
                self.buffer = collections.deque(maxlen=300)
                self.buffer_lock = threading.Lock()
                chunk = np.random.randn(16000).astype(np.float32) * 0.01
                self.buffer.append((0, chunk, time.time(), 0.01))

        bus_key = media_bus._bus_key("audio", None)
        with media_bus._buses_lock:
            media_bus._buses[bus_key] = FakeBus()

        try:
            svc.start()
            svc.thread.join(timeout=5)

            assert not svc.thread.is_alive()
            assert svc.last_error is not None
            assert "wakeword_fatal" in svc.last_error
            assert "KeyboardInterrupt" in svc.last_error
        finally:
            svc.stop()
            with media_bus._buses_lock:
                media_bus._buses.pop(bus_key, None)

    def test_system_exit_caught_in_run(self, default_config, event_loop_thread):
        """SystemExit during processing should be caught by _run's BaseException handler."""
        svc = _WakewordService(default_config, event_loop_thread)

        svc._model.predict = lambda audio: (_ for _ in ()).throw(SystemExit(0))

        class FakeBus:
            def __init__(self):
                self.samplerate = 16000
                self.buffer = collections.deque(maxlen=300)
                self.buffer_lock = threading.Lock()
                chunk = np.random.randn(16000).astype(np.float32) * 0.01
                self.buffer.append((0, chunk, time.time(), 0.01))

        bus_key = media_bus._bus_key("audio", None)
        with media_bus._buses_lock:
            media_bus._buses[bus_key] = FakeBus()

        try:
            svc.start()
            svc.thread.join(timeout=5)

            assert not svc.thread.is_alive()
            assert svc.last_error is not None
            assert "wakeword_fatal" in svc.last_error
        finally:
            svc.stop()
            with media_bus._buses_lock:
                media_bus._buses.pop(bus_key, None)


# ---------------------------------------------------------------------------
# Media bus tuple format compatibility
# ---------------------------------------------------------------------------


class TestMediaBusTupleCompat:
    """Verify that all code paths handle 4-element tuples from media_bus."""

    def test_entry_index_access_pattern(self):
        """The entry[0], entry[1] access pattern works for both 3 and 4 tuples."""
        entry3 = (42, np.zeros(100, dtype=np.float32), time.time())
        entry4 = (42, np.zeros(100, dtype=np.float32), time.time(), 0.05)

        for entry in [entry3, entry4]:
            idx = entry[0]
            data = entry[1]
            assert idx == 42
            assert isinstance(data, np.ndarray)
            assert data.shape == (100,)

    def test_real_bus_buffer_format(self):
        """Simulate what media_bus actually appends and verify unpacking."""
        buffer = collections.deque(maxlen=300)
        for i in range(10):
            chunk = np.random.randn(4410).astype(np.float32)
            rms = float(np.sqrt(np.mean(np.square(chunk))))
            buffer.append((i, chunk, time.time(), rms))

        snap = list(buffer)
        cursor = 0
        processed = 0

        for entry in snap:
            idx, data = entry[0], entry[1]
            if idx < cursor:
                continue
            cursor = max(cursor, idx + 1)
            mono = _to_mono(data)
            res = _resample_linear(mono, sr_in=44100, sr_out=SAMPLE_RATE)
            assert res.dtype == np.float32
            processed += 1

        assert processed == 10
        assert cursor == 10


# ---------------------------------------------------------------------------
# Integration: full wakeword pipeline with mock bus
# ---------------------------------------------------------------------------


class TestWakewordIntegration:
    def test_full_pipeline_no_crash(self, weights_path, event_loop_thread):
        """Full pipeline: model load → service start → process audio → stop."""
        cfg = _WakewordConfig(
            sensitivity=0.7,
            cooldown_s=0.5,
            device=None,
            weights_path=weights_path,
            trigger_count=2,
            ema_alpha=0.3,
        )
        svc = _WakewordService(cfg, event_loop_thread)
        assert svc._model is not None

        # Populate a fake bus with multiple batches of audio
        class StreamingBus:
            def __init__(self):
                self.samplerate = 44100
                self.buffer = collections.deque(maxlen=300)
                self.buffer_lock = threading.Lock()
                self._idx = 0
                self._feeder = threading.Thread(target=self._feed, daemon=True)
                self._stop = threading.Event()

            def _feed(self):
                while not self._stop.is_set():
                    chunk = np.random.randn(4410).astype(np.float32) * 0.01
                    rms = float(np.sqrt(np.mean(np.square(chunk))))
                    with self.buffer_lock:
                        self.buffer.append((self._idx, chunk, time.time(), rms))
                        self._idx += 1
                    time.sleep(0.1)

            def start(self):
                self._feeder.start()

            def stop(self):
                self._stop.set()
                self._feeder.join(timeout=3)

        bus = StreamingBus()
        bus.start()
        bus_key = media_bus._bus_key("audio", None)
        with media_bus._buses_lock:
            media_bus._buses[bus_key] = bus

        try:
            svc.start()
            time.sleep(3)  # Let it process several iterations
            svc.stop()
            bus.stop()

            assert svc.last_score is not None
            assert svc.last_decision is not None
            assert svc.last_infer_ms is not None
            assert svc.last_infer_ms > 0
            assert svc.last_error is None
            # Verify EMA was applied (decision may differ from score)
            assert isinstance(svc.last_decision, float)
            assert 0.0 <= svc.last_decision <= 1.0
        finally:
            with media_bus._buses_lock:
                media_bus._buses.pop(bus_key, None)
