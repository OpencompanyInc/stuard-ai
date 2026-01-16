# Inline Scripts in Workflows

You can now write custom Python and JavaScript code directly in your workflows without needing external files.

## Features

- ✅ **Inline Python scripts** with managed virtual environments
- ✅ **Inline JavaScript/Node.js scripts**
- ✅ **No external files needed** - write code directly in workflow JSON
- ✅ **Full stdout/stderr capture** for debugging
- ✅ **Timeout control** and error handling

## Python Inline Scripts

### Basic Example

```json
{
  "name": "hello-python",
  "version": "1",
  "steps": [
    {
      "id": "run_script",
      "uses": "local.run_python_script",
      "with": {
        "code": "print('Hello from inline Python!')\nprint('Current time:', __import__('datetime').datetime.now())",
        "timeoutMs": 5000
      }
    },
    {
      "id": "log_result",
      "uses": "local.log",
      "with": {
        "message": "Exit: {{run_script.exitCode}}, Output: {{run_script.stdout}}"
      }
    }
  ]
}
```

### With Virtual Environment and Dependencies

```json
{
  "name": "data-processor",
  "version": "1",
  "steps": [
    {
      "id": "setup_env",
      "uses": "local.python_install",
      "with": {
        "envId": "data-tools",
        "packages": ["pandas==2.1.0", "numpy==1.26.0"]
      }
    },
    {
      "id": "process_data",
      "uses": "local.run_python_script",
      "with": {
        "envId": "data-tools",
        "code": "import pandas as pd\nimport numpy as np\n\ndata = {'A': [1, 2, 3], 'B': [4, 5, 6]}\ndf = pd.DataFrame(data)\nprint('Mean:', df.mean().to_dict())\nprint('Sum:', df.sum().to_dict())",
        "timeoutMs": 30000
      }
    }
  ]
}
```

### With Command-Line Arguments

```json
{
  "id": "process_file",
  "uses": "local.run_python_script",
  "with": {
    "code": "import sys\nprint(f'Processing: {sys.argv[1]}')\nwith open(sys.argv[1], 'r') as f:\n    print(f'Lines: {len(f.readlines())}')",
    "args": ["{{webhook.filePath}}"]
  }
}
```

## JavaScript/Node.js Inline Scripts

### Basic Example

```json
{
  "name": "hello-node",
  "version": "1",
  "steps": [
    {
      "id": "run_script",
      "uses": "local.run_node_script",
      "with": {
        "code": "console.log('Hello from inline Node.js!');\nconsole.log('Process:', process.version);",
        "timeoutMs": 5000
      }
    },
    {
      "id": "log_result",
      "uses": "local.log",
      "with": {
        "message": "Exit: {{run_script.exitCode}}, Output: {{run_script.stdout}}"
      }
    }
  ]
}
```

### File Processing

```json
{
  "id": "process_json",
  "uses": "local.run_node_script",
  "with": {
    "code": "const fs = require('fs');\nconst data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));\nconsole.log('Keys:', Object.keys(data).join(', '));\nconsole.log('Count:', Object.keys(data).length);",
    "args": ["{{webhook.jsonPath}}"]
  }
}
```

### Async Operations

```json
{
  "id": "fetch_data",
  "uses": "local.run_node_script",
  "with": {
    "code": "(async () => {\n  const https = require('https');\n  const url = process.argv[1];\n  const data = await new Promise((resolve, reject) => {\n    https.get(url, (res) => {\n      let body = '';\n      res.on('data', (chunk) => body += chunk);\n      res.on('end', () => resolve(body));\n    }).on('error', reject);\n  });\n  console.log('Fetched:', data.length, 'bytes');\n})();",
    "args": ["https://api.example.com/data"],
    "timeoutMs": 10000
  }
}
```

## Real-World Examples

### Image Metadata Extractor

```json
{
  "name": "image-metadata",
  "version": "1",
  "triggers": [{"type": "webhook.local"}],
  "steps": [
    {
      "id": "setup",
      "uses": "local.python_install",
      "with": {
        "envId": "image-tools",
        "packages": ["Pillow==10.1.0"]
      }
    },
    {
      "id": "extract",
      "uses": "local.run_python_script",
      "with": {
        "envId": "image-tools",
        "code": "from PIL import Image\nimport sys\nimport json\n\nimg = Image.open(sys.argv[1])\nmetadata = {\n    'format': img.format,\n    'mode': img.mode,\n    'size': img.size,\n    'width': img.width,\n    'height': img.height\n}\nprint(json.dumps(metadata))",
        "args": ["{{webhook.imagePath}}"]
      }
    },
    {
      "id": "log",
      "uses": "local.log",
      "with": {
        "message": "Metadata: {{extract.stdout}}"
      }
    }
  ]
}
```

### Text File Analyzer

```json
{
  "name": "text-analyzer",
  "version": "1",
  "triggers": [{"type": "webhook.local"}],
  "steps": [
    {
      "id": "analyze",
      "uses": "local.run_node_script",
      "with": {
        "code": "const fs = require('fs');\nconst text = fs.readFileSync(process.argv[1], 'utf8');\nconst lines = text.split('\\n');\nconst words = text.split(/\\s+/).filter(w => w.length > 0);\nconst chars = text.length;\nconsole.log(JSON.stringify({\n  lines: lines.length,\n  words: words.length,\n  chars: chars,\n  avgWordLength: (chars / words.length).toFixed(2)\n}));",
        "args": ["{{webhook.filePath}}"]
      }
    },
    {
      "id": "log",
      "uses": "local.log",
      "with": {
        "message": "Analysis: {{analyze.stdout}}"
      }
    }
  ]
}
```

## Tips

1. **Escape newlines**: Use `\n` for multi-line code in JSON
2. **Use template variables**: Access webhook data with `{{webhook.field}}`
3. **Capture output**: Use `stdout` and `stderr` fields in next steps
4. **Set timeouts**: Default is 30s, increase for long-running scripts
5. **Virtual envs**: Use `envId` for Python scripts with dependencies
6. **Error handling**: Check `exitCode` - 0 means success

## Troubleshooting

### Python script fails with "env_not_found"
- Run `python_install` step first to create the environment
- Or omit `envId` to use system Python

### Node script fails with "node_not_found"
- Install Node.js on your system
- Ensure `node` is in your PATH

### Script times out
- Increase `timeoutMs` (max 600000 = 10 minutes)
- Check for infinite loops or blocking operations

### Output not captured
- Use `print()` in Python, `console.log()` in Node.js
- Check `stderr` field for error messages
