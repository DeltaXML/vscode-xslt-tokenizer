# XPath-Embedded

A VSCode language extension for XPath 3.1, XSLT 3.0 and more.

### Main Features
- XSLT 3.0 and XPath 3.1 Syntax highlighting
  - Using character by character lexer - no regular expressions
- code analysis with transient structures instead of cpu-intensive abstract syntax tree
- XSLT 3.0 and XPath 3.1 Formatting
  - Format document
  - Format selection
  - Format on paste
  - Format on type
- Suppports Saxon and EXPath extension namespaces
- Supports proposed XSLT 4.0 language extensions
- XSLT Outline View
- XSLT/XPath Symbol-lookup
- XML Well-Formedness Checking
- XSLT Static Code Checking (wip)
- XPath Static Code Checking
- Mark unused variables
- Close-tag auto-completion with tag-name
- Tag renaming - start tag synchronised with close tag
- *Saxon XSLT* Transform Task Provider (requires Java)
- Numerous pre-compile checks for improved diagnostics
- Checks XML well-formedness (excludes internal DTD subset)
- Checks variable/param references
- Checks higher-order function references
- Checks XPath keywords
- Checks internal/user-defined function names and arity
- Checks XSLT imports/includes asynchronously
- Checks accumulator and attribute-set names
- Checks mode names used in apply-templates instruction
- Checks template names and param names in call-templates instruction
- Checks for duplicate global symbol names
- Checks prefixes for node-name tests
- Checks atomic type names

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
    "editor.semanticTokenColorCustomizations":{
      "[Monokai +Blue]": {"enabled": true}
    },
}
  ```

Or, to enable syntax highlighting for all themes:

```json
{
    "editor.semanticTokenColorCustomizations":{
      "enabled": true
    },
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


