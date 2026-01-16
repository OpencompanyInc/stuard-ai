# Workflow Examples

This directory contains example workflows for Stuard AI.

## Unified UI System

The **Unified UI Architecture** allows you to create custom, seamless UIs with standard CSS, flexible layouts, and automatic data binding.

### Reference: `unified_ui_reference.json`
Check this file for a complete example of:
- **Global CSS**: Injecting styles for animations, themes, and layouts.
- **Layout Engine**: Using `div`, `input`, `button`, etc., with class names.
- **Auto-Binding**: Using `bind="variableName"` to sync inputs with local state.
- **Event Handling**: Using `on="click:submit"` or `on="click:close"`.
- **Window Control**: Configuring `width`, `height`, `frameless`, and `transparent`.

### Usage
To use the Custom UI tool in your workflow:
```json
{
  "tool": "custom_ui",
  "args": {
    "title": "My UI",
    "window": { "width": 400, "height": 500 },
    "css": ".my-class { color: red; }",
    "layout": {
      "type": "div",
      "className": "my-class",
      "children": "Hello World"
    }
  }
}
```
