from app.tools.system import _resolve_cwd


def test_resolve_cwd_keeps_existing_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert _resolve_cwd(str(tmp_path), fallback_to_process=True) == str(tmp_path.resolve())


def test_resolve_cwd_falls_back_for_missing_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    missing = tmp_path / "does-not-exist"
    assert _resolve_cwd(str(missing), fallback_to_process=True) == str(tmp_path.resolve())


def test_resolve_cwd_falls_back_for_placeholder_values(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert _resolve_cwd("{{$workspace.data}}", fallback_to_process=True) == str(tmp_path.resolve())
    assert _resolve_cwd("", fallback_to_process=True) == str(tmp_path.resolve())
