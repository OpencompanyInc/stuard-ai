from app.tool_approval import command_looks_write_or_destructive, run_command_requires_approval


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
