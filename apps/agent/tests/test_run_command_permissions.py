from app.tool_approval import (
    command_looks_write_or_destructive,
    run_command_requires_approval,
    terminal_tool_requires_approval,
)


def test_read_only_commands_do_not_require_approval():
    assert command_looks_write_or_destructive("Get-ChildItem -Force") is False
    assert run_command_requires_approval({
        "command": "Get-ChildItem -Force",
        "isPermissionRequired": False,
    }) is False
    assert run_command_requires_approval({"command": "git status"}) is False


def test_write_like_commands_require_approval_even_if_flag_is_false():
    assert command_looks_write_or_destructive("echo hi > out.txt") is True
    assert run_command_requires_approval({
        "command": "echo hi > out.txt",
        "isPermissionRequired": False,
    }) is True
    assert run_command_requires_approval({
        "command": "Set-Content notes.txt 'hi'",
        "isPermissionRequired": False,
    }) is True
    assert run_command_requires_approval({"command": "npm install"}) is True


def test_explicit_flag_can_still_require_approval_for_safe_commands():
    assert run_command_requires_approval({
        "command": "Get-Process",
        "isPermissionRequired": True,
    }) is True


# ── Terminal tool permission tests ──────────────────────────────────────────

def test_terminal_tool_skips_non_permission_tools():
    assert terminal_tool_requires_approval("terminal_list", {}) is False
    assert terminal_tool_requires_approval("terminal_get", {}) is False
    assert terminal_tool_requires_approval("terminal_read", {}) is False
    assert terminal_tool_requires_approval("terminal_wait_for", {}) is False


def test_terminal_tool_respects_isPermissionRequired_false():
    for tool in ("terminal_create", "terminal_send_input", "terminal_send_raw", "terminal_send_keys", "terminal_destroy"):
        assert terminal_tool_requires_approval(tool, {"isPermissionRequired": False}) is False


def test_terminal_tool_respects_isPermissionRequired_true():
    for tool in ("terminal_create", "terminal_send_input", "terminal_send_raw", "terminal_send_keys", "terminal_destroy"):
        assert terminal_tool_requires_approval(tool, {"isPermissionRequired": True}) is True


def test_terminal_tool_defaults_to_requiring_approval_when_flag_missing():
    for tool in ("terminal_create", "terminal_send_input", "terminal_send_raw", "terminal_send_keys", "terminal_destroy"):
        assert terminal_tool_requires_approval(tool, {}) is True
        assert terminal_tool_requires_approval(tool, None) is True
