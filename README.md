# XPath-Embedded

XPath Embedded provides comprehensive language support XSLT 3.0 and XPath 3.0 in VSCode.

## Features

 - XSLT 3.0 / XPATH 3.1
 - Syntax Highlighting
 - Formatting - on-type/on-paste/document/selection
 - Code Diagnostics
 - XML Well-Formedness Checking
 - Code symbol outline
 - Code symbol lookup
 - xsl:include/xsl:import links
 - Goto Definition
 - Tag Rename
 - Auto tag-close
 - Language Snippets
 
For lexical analysis, this extension processes code character-by-character. This analysis is exploited for all features including *all* syntax highlighting. The avoidance of the much more common use of regular expressions on a line-by-line basis has provided many benefits. These benefits include improved responsiveness, lower CPU load, improved code maintainability and full integrity for syntax highlighting.

This extension performs a comprehensive set of checks on the code, before any XSLT compilation. This ensures that any code symbols within XSLT or XPath with problems are accurately identified at the symbol-level. Asynchronous processing for xsl:include/xsl:import dependencies allows references to symbol definitions can be checked regarless of the location of the defintition.

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


