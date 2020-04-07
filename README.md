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

See: [XPath Embedded Wiki](https://github.com/DeltaXML/vscode-xslt-tokenizer/wiki/)

## Formatting

### VSCode Formatting Command Keyboard Shortcuts
1. *On Windows* - ```Shift + Alt + F```.
2. *On Mac* - ```Shift + Option + F```.
3. *On Ubuntu* - ```Ctrl + Shift + I```.

### Editor Settings for Highlighting in Color Theme Extensions

Syntax highlighting is currently only enabled in built-in themes. This is because the 'Semantic Highlighting' used by XPath Embedded does not work well with some languages and some themes.

To enable syntax highighting for a custom theme you need to change User Settings. For example, to enable syntax highlighting for XSLT in the *City Lights* theme use:
```json
{
	"editor.tokenColorCustomizations": {
		"[City Lights]": {
			"semanticHighlighting": true
		}
	}
}
  ```

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


