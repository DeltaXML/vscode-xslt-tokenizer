# XPath-Embedded

A VSCode extension for XPath 3.1, XSLT 3.0 and more.

### Main Editor Features
- XSLT 3.0 and XPath 3.1 Syntax highlighting
- XSLT 3.0 and XPath 3.1 Formatting
  - Document Formatting
  - Selection Formatting
  - On Type: New line Indentation
- Bracket Matching
- *Saxon XSLT* Transform Task Provider (requires Java)

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


