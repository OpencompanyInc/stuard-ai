# Workflow System Improvements

## Summary

Fixed three critical issues with the Stuard workflow system:

1. ✅ **Fixed Python venv creation warning** (Python 3.13+ compatibility)
2. ✅ **Fixed "New flow" button** (now creates proper starter workflows)
3. ✅ **Added inline script support** (write Python/JS directly in workflows)

---

## 1. Fixed Python Virtual Environment Creation

### Problem
When creating Python virtual environments on Python 3.13+, users saw this warning:
```
Unable to copy 'C:\Python313\Lib\venv\scripts\nt\venvlauncher.exe' to '...\python.exe'
```

### Solution
Modified `apps/agent/app/tools/system.py` to use `--without-pip` flag during venv creation, then install pip separately via `ensurepip`. This avoids the venvlauncher.exe copy issue.

### Changes
- `python_install()` now uses: `python -m venv --without-pip <env_dir>`
- Then runs: `python -m ensurepip --upgrade`
- Then upgrades pip: `pip install --upgrade pip setuptools wheel`

### Result
Clean venv creation with no warnings, fully functional pip installation.

---

## 2. Fixed "New Flow" Button

### Problem
Clicking "New flow" created an empty workflow skeleton that the UI couldn't render properly, causing confusion.

### Solution
Modified `apps/desktop/src/renderer/workflows.tsx` to create a proper starter workflow with:
- Valid workflow structure (name, version, description, mode)
- A webhook trigger
- A starter log step
- Proper conversion via `stuardsImportWorkflow` to generate valid StuardSpec

### Changes
```typescript
const skeleton = {
  id: safe,
  name: "My Flow",
  description: "A new workflow",
  version: "1",
  mode: "manual",
  triggers: [{ type: "webhook.local", args: {} }],
  steps: [
    {
      id: "start",
      uses: "local.log",
      with: { message: "Workflow started" }
    }
  ]
};
```

### Result
Users can now click "New flow", enter an ID, and immediately see a working workflow they can edit and run.

---

## 3. Added Inline Script Support

### Problem
Users had to create external `.py` or `.js` files to run custom scripts, making workflows less portable and harder to share.

### Solution
Enhanced `run_python_script` and added new `run_node_script` tool to support inline code execution.

### New Features

#### Python Inline Scripts
```json
{
  "id": "process",
  "uses": "local.run_python_script",
  "with": {
    "code": "import sys\nprint('Hello!')\nprint(f'Args: {sys.argv[1:]}')",
    "args": ["{{webhook.data}}"],
    "envId": "my-env",
    "timeoutMs": 30000
  }
}
```

#### JavaScript/Node.js Inline Scripts
```json
{
  "id": "process",
  "uses": "local.run_node_script",
  "with": {
    "code": "console.log('Hello!');\nconsole.log('Args:', process.argv.slice(2));",
    "args": ["{{webhook.data}}"],
    "timeoutMs": 30000
  }
}
```

### Changes Made

1. **Enhanced `run_python_script` tool** (`apps/cloud-ai/src/tools/device-tools.ts`)
   - Added descriptions for `code` and `path` parameters
   - Clarified inline vs file usage

2. **Added `run_node_script` tool** (`apps/cloud-ai/src/tools/device-tools.ts`)
   - Same interface as `run_python_script` but for JavaScript
   - Supports inline `code` or file `path`
   - Full stdout/stderr capture

3. **Implemented `run_node_script` handler** (`apps/agent/app/tools/system.py`)
   - Finds Node.js executable via `shutil.which("node")`
   - Creates temp `.js` files for inline code
   - Executes with timeout and captures output

4. **Registered new tool** (`apps/agent/app/tools/dispatch.py`)
   - Added `run_node_script` to handlers map
   - Added to emit-supporting tools list

### Result
Users can now write Python and JavaScript code directly in workflow JSON, making workflows:
- ✅ Self-contained (no external files needed)
- ✅ Portable (copy/paste workflows between systems)
- ✅ Easier to share (single JSON file)
- ✅ Version controlled (code lives with workflow definition)

---

## Documentation

Created comprehensive documentation:

1. **`docs/INLINE_SCRIPTS.md`**
   - Complete guide to inline scripts
   - Python and Node.js examples
   - Real-world use cases (image metadata, text analysis)
   - Troubleshooting tips

2. **Example workflows** (`apps/agent/stuard-workflows/examples/`)
   - `inline-python-test.json` - Test Python inline execution
   - `inline-node-test.json` - Test Node.js inline execution

---

## Testing

### Test the fixes:

1. **Test venv creation** (should have no warnings):
```powershell
# Delete old env
Remove-Item -Recurse -Force "$env:APPDATA\StuardAI\python\envs\test-env" -ErrorAction SilentlyContinue

# Import a workflow that uses python_install
# Should see clean creation with no venvlauncher.exe warnings
```

2. **Test "New flow" button**:
   - Open Workflows window
   - Click "New flow"
   - Enter ID: "test-flow"
   - Should see a working workflow with a log step
   - Click "Run" to verify it works

3. **Test inline Python**:
```powershell
# Import inline-python-test.json via Import Stuard
# Deploy and run via webhook
Invoke-WebRequest -Uri "http://127.0.0.1:18080/webhooks/incoming/inline-python-test" -Method POST -ContentType "application/json" -Body '{}'
```

4. **Test inline Node.js**:
```powershell
# Import inline-node-test.json via Import Stuard
# Deploy and run via webhook
Invoke-WebRequest -Uri "http://127.0.0.1:18080/webhooks/incoming/inline-node-test" -Method POST -ContentType "application/json" -Body '{}'
```

---

## Migration Guide

### For existing workflows using external scripts:

**Before** (external file):
```json
{
  "id": "convert",
  "uses": "local.run_python_script",
  "with": {
    "path": "C:\\Users\\solar\\video_to_audio.py",
    "args": ["{{webhook.videoPath}}", "{{webhook.outputPath}}"],
    "envId": "video-tools"
  }
}
```

**After** (inline):
```json
{
  "id": "convert",
  "uses": "local.run_python_script",
  "with": {
    "code": "import sys\nfrom moviepy.editor import VideoFileClip\n\nvideo_path = sys.argv[1]\naudio_path = sys.argv[2]\n\nvideo = VideoFileClip(video_path)\nvideo.audio.write_audiofile(audio_path)\nprint(f'ok: wrote audio to {audio_path}')",
    "args": ["{{webhook.videoPath}}", "{{webhook.outputPath}}"],
    "envId": "video-tools"
  }
}
```

Both approaches work! Use inline for portability, use external files for complex scripts.

---

## Next Steps

Consider these enhancements:

1. **Script library** - Create a collection of reusable inline scripts
2. **Script editor UI** - Add a code editor in the Workflows window for inline scripts
3. **Script templates** - Pre-built snippets for common tasks
4. **Syntax highlighting** - Visual feedback when editing inline code
5. **Script validation** - Lint Python/JS before saving workflows

---

## Files Changed

- `apps/agent/app/tools/system.py` - Fixed venv creation, added run_node_script
- `apps/agent/app/tools/dispatch.py` - Registered run_node_script
- `apps/cloud-ai/src/tools/device-tools.ts` - Enhanced descriptions, added run_node_script
- `apps/desktop/src/renderer/workflows.tsx` - Fixed New flow button
- `docs/INLINE_SCRIPTS.md` - New documentation
- `apps/agent/stuard-workflows/examples/` - New example workflows
