# Custom UI JavaScript API Reference

The enhanced Custom UI system in StuardAI now includes full JavaScript support via the `stuard` API, allowing you to build interactive, dynamic UIs that can interact with workflows, call tools, and access system features.

## Table of Contents

- [Basic Usage](#basic-usage)
- [Workflow Tool Calling](#workflow-tool-calling)
- [Node Routing (callNode)](#node-routing-callnode)
- [File Dialogs](#file-dialogs)
- [File I/O](#file-io)
- [Clipboard Operations](#clipboard-operations)
- [Notifications](#notifications)
- [Window Actions](#window-actions)
- [Window Controls](#window-controls)
- [Events](#events)
- [System Information](#system-information)
- [Complete Examples](#complete-examples)

---

## Basic Usage

Add JavaScript to your custom UI using the `script` argument:

```json
{
  "tool": "custom_ui",
  "args": {
    "id": "my_window",
    "title": "My App",
    "html": "<button id=\"btn\">Click Me</button>",
    "script": "document.getElementById('btn').addEventListener('click', () => {\n  stuard.notify('Hello', 'Button clicked!');\n});",
    "data": { "counter": 0 }
  }
}
```

The `stuard` API is available as `window.stuard` in your script.

---

## Workflow Tool Calling

Call any workflow tool from within your UI:

### `stuard.callTool(toolName, args)`

**Parameters:**
- `toolName` (string): Name of the workflow tool
- `args` (object): Tool arguments

**Returns:** Promise resolving to tool result

**Example:**

```javascript
// Get clipboard content
const result = await stuard.callTool('get_clipboard_content');
if (result.ok) {
  console.log('Clipboard:', result.text);
}

// Web search
const search = await stuard.callTool('web_search', {
  query: 'JavaScript tutorial'
});

// AI inference
const aiResult = await stuard.callTool('ai_inference', {
  prompt: 'Summarize this text',
  input: 'Long text here...',
  mode: 'text' // text | json | embedding
});
```

---

## Node Routing (callNode)

Call sibling nodes in the same workflow by ID or label. This is the **node-routing architecture** — instead of encoding all logic inside one custom_ui component, you decompose the workflow into standalone tool nodes connected by callNode wires.

### `stuard.callNode(nodeId, data)`

**Parameters:**
- `nodeId` (string): The target node's step ID **or label**
- `data` (object): Data passed to the node. The node's args use `{{caller.X}}` templates which are replaced with matching keys from this object.

**Returns:** Promise resolving to the tool result

**Node matching priority:**
1. Exact step ID match (e.g. `"step_abc123"`)
2. Exact label match, case-insensitive (e.g. `"Read File"` matches `"read file"`)
3. Normalized label match — whitespace, underscores, hyphens are interchangeable (`"read_file"` matches `"Read File"`, `"read-file"`, `"Read_File"`)

**Example:**

```javascript
// Call by step ID
const result = await stuard.callNode('step_abc123', { filePath: '/path/to/file' });

// Call by label (recommended — more readable)
const result = await stuard.callNode('Read File', { filePath: '/path/to/file' });
const dbResult = await stuard.callNode('setup_db', {});
const scanResult = await stuard.callNode('Scan Files', { workspace: '/my/project' });
```

**Wire setup:** Connect the custom_ui node to each target node with a callNode wire:

```json
{
  "wires": [
    { "from": "my_ui", "to": "read_node", "callNode": true },
    { "from": "my_ui", "to": "db_node", "callNode": true }
  ]
}
```

- callNode wires render as **dashed teal lines** with a plug icon on the canvas
- They are **NOT auto-traversed** by the engine — they execute on-demand only
- The target node **lights up** with animated particles during execution

**Target node args with `{{caller.X}}` templates:**

```json
{
  "id": "read_node",
  "tool": "read_file",
  "label": "Read File",
  "args": { "path": "{{caller.filePath}}" }
}
```

When called with `stuard.callNode('Read File', { filePath: '/my/file.txt' })`, the `{{caller.filePath}}` template is replaced with `/my/file.txt`.

**callNode vs callTool:**
| | `callTool` | `callNode` |
|---|---|---|
| Visual feedback | None (invisible) | Wire animation + node highlight |
| Target | Any tool by name | Sibling node by ID or label |
| Template support | No | `{{caller.X}}` in node args |
| Canvas visibility | Hidden | Visible — users see which tools run |

---

## File Dialogs

Native file picker dialogs (no tkinter or Python needed):

### `stuard.pickFile(options)`

**Parameters:**
```javascript
{
  title: 'Select File',              // Dialog title
  multiple: false,                   // Allow multiple selection
  filters: [                         // File type filters
    { name: 'Images', extensions: ['jpg', 'png'] },
    { name: 'All Files', extensions: ['*'] }
  ]
}
```

**Returns:** `Promise<{ canceled: boolean, filePaths: string[] }>`

**Example:**

```javascript
const file = await stuard.pickFile({
  title: 'Select Image',
  filters: [{ name: 'Images', extensions: ['jpg', 'png', 'gif'] }]
});

if (!file.canceled) {
  console.log('Selected:', file.filePaths[0]);
}
```

### `stuard.pickFolder(options)`

**Parameters:**
```javascript
{
  title: 'Select Folder',
  multiple: false
}
```

**Returns:** `Promise<{ canceled: boolean, filePaths: string[] }>`

**Example:**

```javascript
const folder = await stuard.pickFolder({ title: 'Choose Directory' });
if (!folder.canceled) {
  console.log('Folder:', folder.filePaths[0]);
}
```

### `stuard.pickSavePath(options)`

**Parameters:**
```javascript
{
  title: 'Save As',
  defaultPath: 'output.txt',
  filters: [{ name: 'Text', extensions: ['txt'] }]
}
```

**Returns:** `Promise<{ canceled: boolean, filePath: string | undefined }>`

**Example:**

```javascript
const save = await stuard.pickSavePath({
  title: 'Save File',
  defaultPath: 'notes.md'
});

if (!save.canceled && save.filePath) {
  console.log('Save to:', save.filePath);
}
```

---

## File I/O

Read and write files directly:

### `stuard.readFile(filePath, encoding?)`

**Parameters:**
- `filePath` (string): Path to file
- `encoding` (string, optional): File encoding (default: 'utf-8')

**Returns:** `Promise<string>`

**Example:**

```javascript
const content = await stuard.readFile('C:/path/to/file.txt');
console.log(content);
```

### `stuard.writeFile(filePath, content)`

**Parameters:**
- `filePath` (string): Path to file
- `content` (string): Content to write

**Returns:** `Promise<void>`

**Example:**

```javascript
await stuard.writeFile('C:/path/to/output.txt', 'Hello World!');
```

---

## Clipboard Operations

### `stuard.copyToClipboard(text)`

Copy text to clipboard.

**Example:**

```javascript
await stuard.copyToClipboard('Hello World!');
stuard.notify('Copied!', 'Text copied to clipboard');
```

### `stuard.readClipboard()`

Read text from clipboard.

**Returns:** `Promise<string>`

**Example:**

```javascript
const text = await stuard.readClipboard();
console.log('Clipboard:', text);
```

---

## Notifications

### `stuard.notify(title, body?)`

Show a system notification.

**Example:**

```javascript
stuard.notify('Task Complete', 'Your file has been processed');
```

---

## Window Actions

Control the custom UI window:

### `stuard.submit(data?, keepOpen?)`

Submit form data and optionally close the window.

**Parameters:**
- `data` (object, optional): Data to return to workflow
- `keepOpen` (boolean, optional): Keep window open after submit

**Example:**

```javascript
// Submit and close
stuard.submit({ username: 'john', email: 'john@example.com' });

// Submit but keep open
stuard.submit({ progress: 50 }, true);
```

### `stuard.close(data?)`

Close the window with optional data.

**Example:**

```javascript
stuard.close({ action: 'cancelled', reason: 'User clicked X' });
```

### `stuard.action(actionName, data?)`

Trigger a custom action without closing the window.

**Example:**

```javascript
stuard.action('refresh', { lastUpdate: Date.now() });
```

### `stuard.stopWorkflow()`

Stop the current workflow execution.

**Example:**

```javascript
document.getElementById('stop-btn').addEventListener('click', () => {
  stuard.stopWorkflow();
});
```

---

## Window Controls

Manipulate the window appearance and position:

### `stuard.resize(width, height)`

Resize the window.

**Example:**

```javascript
stuard.resize(800, 600);
```

### `stuard.moveTo(x, y)`

Move the window to specific coordinates.

**Example:**

```javascript
stuard.moveTo(100, 100);
```

### `stuard.center()`

Center the window on screen.

**Example:**

```javascript
stuard.center();
```

### `stuard.setAlwaysOnTop(flag)`

Set always-on-top behavior.

**Example:**

```javascript
stuard.setAlwaysOnTop(true);
```

### `stuard.minimize()`

Minimize the window.

**Example:**

```javascript
stuard.minimize();
```

---

## Events

Bidirectional event communication between UI and workflow:

### `stuard.emit(eventName, data?)`

Emit an event to the workflow.

**Example:**

```javascript
stuard.emit('user-action', { action: 'clicked', button: 'save' });
```

### `stuard.on(eventName, callback)`

Listen for events from the workflow.

**Returns:** Unsubscribe function

**Example:**

```javascript
const unsubscribe = stuard.on('progress-update', (data) => {
  document.getElementById('progress').textContent = data.percent + '%';
});

// Later, unsubscribe:
unsubscribe();
```

### `stuard.onDataUpdate(callback)`

Listen for data updates from the workflow.

**Example:**

```javascript
stuard.onDataUpdate((newData) => {
  console.log('Data updated:', newData);
  // Update UI with new data
});
```

---

## System Information

### `stuard.getScreenInfo()`

Get screen dimensions and work area.

**Returns:**
```javascript
{
  width: 1920,
  height: 1080,
  workArea: { x: 0, y: 0, width: 1920, height: 1040 }
}
```

**Example:**

```javascript
const info = await stuard.getScreenInfo();
console.log('Screen size:', info.width, 'x', info.height);
```

---

## Complete Examples

### Example 1: Clipboard Manager

```json
{
  "tool": "custom_ui",
  "args": {
    "id": "clipboard_manager",
    "title": "Clipboard History",
    "window": { "width": 400, "height": 500 },
    "html": "<div class=\"p-4\"><input id=\"search\" placeholder=\"Search...\" class=\"w-full mb-2\" /><div id=\"history\" class=\"space-y-1\"></div></div>",
    "script": "const history = JSON.parse(localStorage.getItem('clips') || '[]');\n\n// Add current clipboard\nconst current = await stuard.callTool('get_clipboard_content');\nif (current.ok && current.text && !history.find(h => h.text === current.text)) {\n  history.unshift({ text: current.text, time: Date.now() });\n  if (history.length > 50) history.pop();\n  localStorage.setItem('clips', JSON.stringify(history));\n}\n\nfunction render() {\n  const search = document.getElementById('search').value.toLowerCase();\n  const filtered = history.filter(h => h.text.toLowerCase().includes(search));\n  \n  document.getElementById('history').innerHTML = filtered.map((h, i) => `\n    <div class=\"p-2 bg-slate-800 rounded cursor-pointer hover:bg-slate-700\" onclick=\"handleClick(${i})\">\n      <div class=\"text-sm truncate\">${h.text.slice(0, 100)}</div>\n      <div class=\"text-xs text-slate-500\">${new Date(h.time).toLocaleTimeString()}</div>\n    </div>\n  `).join('');\n}\n\nwindow.handleClick = async (index) => {\n  const text = history[index].text;\n  await stuard.copyToClipboard(text);\n  stuard.close({ action: 'paste', text });\n};\n\ndocument.getElementById('search').addEventListener('input', render);\ndocument.addEventListener('keydown', e => e.key === 'Escape' && stuard.close());\n\nrender();"
  }
}
```

### Example 2: AI Text Tools

```json
{
  "tool": "custom_ui",
  "args": {
    "id": "text_tools",
    "title": "Text Tools",
    "selectedText": "{{get_clipboard.text}}",
    "window": { "width": 500, "height": 400 },
    "html": "<div class=\"flex flex-col h-screen p-4\"><textarea id=\"input\" class=\"flex-1 mb-2\" placeholder=\"Input text...\"></textarea><div class=\"flex gap-2 mb-2\"><button id=\"uppercase\" class=\"btn\">UPPER</button><button id=\"lowercase\" class=\"btn\">lower</button><button id=\"ai-rewrite\" class=\"btn btn-primary\">AI Rewrite</button></div><textarea id=\"output\" class=\"flex-1\" readonly></textarea><button id=\"copy\" class=\"btn btn-secondary mt-2\">Copy Result</button></div>",
    "script": "const input = document.getElementById('input');\nconst output = document.getElementById('output');\n\ninput.value = formData.selectedText || '';\n\ndocument.getElementById('uppercase').addEventListener('click', () => {\n  output.value = input.value.toUpperCase();\n});\n\ndocument.getElementById('lowercase').addEventListener('click', () => {\n  output.value = input.value.toLowerCase();\n});\n\ndocument.getElementById('ai-rewrite').addEventListener('click', async () => {\n  const result = await stuard.callTool('ai_inference', {\n    prompt: 'Rewrite this text to be clearer and more professional',\n    input: input.value\n  });\n  if (result.ok) output.value = result.text;\n});\n\ndocument.getElementById('copy').addEventListener('click', async () => {\n  await stuard.copyToClipboard(output.value);\n  stuard.notify('Copied!', 'Result copied to clipboard');\n});"
  }
}
```

### Example 3: Image Gallery Viewer

```json
{
  "tool": "custom_ui",
  "args": {
    "id": "gallery",
    "title": "Image Gallery",
    "window": { "width": 800, "height": 600 },
    "html": "<div class=\"flex h-screen\"><div class=\"w-48 border-r p-2\"><button id=\"open-folder\" class=\"btn btn-primary w-full mb-2\">Open Folder</button><div id=\"thumbnails\" class=\"space-y-2\"></div></div><div class=\"flex-1 flex items-center justify-center bg-black\"><img id=\"preview\" class=\"max-w-full max-h-full object-contain\" /></div></div>",
    "script": "let images = [];\nlet currentIndex = 0;\n\ndocument.getElementById('open-folder').addEventListener('click', async () => {\n  const folder = await stuard.pickFolder({ title: 'Select Image Folder' });\n  if (folder.canceled) return;\n  \n  const files = await stuard.callTool('list_directory', { path: folder.filePaths[0] });\n  images = files.entries.filter(e => /\\.(jpg|png|gif|webp)$/i.test(e.name));\n  \n  document.getElementById('thumbnails').innerHTML = images.map((img, i) => `\n    <img src=\"local-file://${img.path}\" class=\"w-full h-24 object-cover rounded cursor-pointer\" onclick=\"showImage(${i})\" />\n  `).join('');\n  \n  if (images.length > 0) showImage(0);\n});\n\nwindow.showImage = (index) => {\n  currentIndex = index;\n  document.getElementById('preview').src = `local-file://${images[index].path}`;\n};\n\ndocument.addEventListener('keydown', (e) => {\n  if (e.key === 'ArrowLeft' && currentIndex > 0) showImage(currentIndex - 1);\n  if (e.key === 'ArrowRight' && currentIndex < images.length - 1) showImage(currentIndex + 1);\n});"
  }
}
```

---

## Tips & Best Practices

1. **Use `localStorage`** to persist data across window opens
2. **Always check `.ok`** on tool call results
3. **Handle errors gracefully** with try/catch
4. **Use `formData` object** to access initial data passed to the window
5. **Add keyboard shortcuts** for better UX (Escape to close, Enter to submit)
6. **Use TailwindCSS classes** (already loaded) for quick styling
7. **Keep scripts concise** - offload heavy operations to workflow tools
8. **Use `data-bind` attributes** for automatic form field binding
9. **Test in the real environment** - the preload script must be compiled first
10. **Return meaningful data** when closing windows for workflow continuation

---

## Accessing Initial Data

Data passed to the `custom_ui` tool is available in the `formData` global:

```json
{
  "tool": "custom_ui",
  "args": {
    "data": { "username": "john", "count": 5 },
    "script": "console.log(formData.username); // 'john'"
  }
}
```

Non-reserved arguments are also auto-merged into `formData`:

```json
{
  "tool": "custom_ui",
  "args": {
    "selectedText": "{{clipboard.text}}",
    "script": "console.log(formData.selectedText);"
  }
}
```

---

## Shorthand API

For quick access, use the `$stuard` alias:

```javascript
// These are equivalent:
stuard.callTool('log', { message: 'Hello' });
$stuard.tool('log', { message: 'Hello' });

stuard.emit('my-event', { data: 'value' });
$stuard.emit('my-event', { data: 'value' });

stuard.close({ result: 'success' });
$stuard.close({ result: 'success' });
```
