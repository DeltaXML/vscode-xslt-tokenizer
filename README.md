# XPath-Embedded

A VSCode extension for XPath 3.1, XSLT 3.0 and more.

### Main £ditor Features
- XSLT 3.0 and XPath 3.1 Syntax highlighting
- XSLT 3.0 and XPath 3.1 Formatting
  - Document Formatting
  - Selection Formatting
  - On Type: New line Indentation
- Bracket Matching
- XSLT Transform Task Provider for Saxon (Java version)

## Sample Screenshots

See: [XPath Embedded Wiki](https://github.com/DeltaXML/vscode-xslt-tokenizer/wiki/XPath-Embedded)

## Formatting

### VSCode Formatting Command Keyboard Shortcuts
1. *On Windows* - ```Shift + Alt + F```.
2. *On Mac* - ```Shift + Option + F```.
3. *On Ubuntu* - ```Ctrl + Shift + I```.

### Editor Settings For Formatting
```json
{
  "[xslt]": {
    "editor.defaultFormatter": "deltaxml.xpath-embedded",
    "editor.formatOnSave": true,
    "editor.formatOnPaste": true,
    "editor.formatOnType": true
  }
}
```
See: [VSCode Documentation on Settings](https://code.visualstudio.com/docs/getstarted/settings)

### Creating XSLT Transform Tasks

VSCode uses Tasks to integrate with external tools. Described in [Tasks in Visual Studio Code](https://code.visualstudio.com/docs/editor/tasks)

This extension provides a 'Saxon XSLT' task that will be shown when a workspace folder is open and the **Create Task** command is invoked from VSCode.
