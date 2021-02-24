[<img src="deltaxmlLogo.png">](https://www.deltaxml.com/?utm_source=VisualStudio&utm_medium=Dev-Tools&utm_campaign=XSLT-XPATH)
# XSLT/XPath for Visual Studio Code

This XSLT/XPath extension for VSCode provides comprehensive language support for XSLT 3.0 and XPath 3.1.

![vscode-xslt](vscode-xslt.png)

*Screenshot showing XSLT symbol-outline, problem-reporting and syntax-highlighting:*
## Features

 - XSLT 3.0 / XPATH 3.1
 - Syntax Highlighter uses [Semantic Highlighting](https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide) exclusively
 - Built-in Code Diagnostics
 - Integration with [Saxon/Saxon-JS XSLT Processors](http://www.saxonica.com/products/products.xml)
 - XSLT Language support for VSCode features:
   - [Auto Completion/Intellisense](https://code.visualstudio.com/docs/editor/intellisense)
   - [Syntax Highlighting Themes](https://code.visualstudio.com/docs/getstarted/themes)
   - [Code Formatting](https://code.visualstudio.com/docs/editor/codebasics#_formatting)
   - [Code Folding](https://code.visualstudio.com/docs/editor/codebasics#_folding)
   - [Snippets](https://code.visualstudio.com/docs/editor/userdefinedsnippets) for XSLT/XPath context
   - [Code symbol outline](https://code.visualstudio.com/docs/getstarted/userinterface#_outline-view)
   - [Goto Symbol](https://code.visualstudio.com/Docs/editor/editingevolved#_peek)
   - [Symbol Breadcrumbs](https://code.visualstudio.com/docs/getstarted/userinterface#_breadcrumbs)
   - [Goto Definition](https://code.visualstudio.com/Docs/editor/editingevolved#_go-to-definition)
   - [Peek Definition](https://code.visualstudio.com/Docs/editor/editingevolved#_peek)
   - [VScode Tasks](https://code.visualstudio.com/Docs/editor/tasks) include custom [XSLT Tasks](https://github.com/DeltaXML/vscode-xslt-tokenizer/wiki/XSLT-Tasks)
   - [Bracket Matching](https://code.visualstudio.com/Docs/editor/editingevolved#_bracket-matching)
   - [Errors and Warnings](https://code.visualstudio.com/Docs/editor/editingevolved#_errors-warnings) for XSLT/XPath Syntax *
 -  Follow `xsl:include` / `xsl:import` / `xsl:use-package` links
 - Custom XML Editing Featues:
   - XML Context-Aware Snippets
   - XML Well-Formedness Checking *
   - Tag Rename
   - Auto tag-close (requires 'formatOnType' setting)
   - Auto clean orphaned end tag after `/` added to make start tag self-close
   - Element Selection Commands:
     - `XML: Select Current element`
     - `XML Select Preceding element`
     - `XML: Select Following element`
     - `XML: Select Parent element`

 ---

   \* Problem-reporting currently depends upon the VSCode symbol-provider. To ensure problems are always reported in VSCode, use the following VSCode setting: `"breadcrumbs.enabled": true`
  
 ---

 ## Introduction
 
For lexical analysis, this extension processes code character-by-character. This analysis is exploited for all features including *all* syntax highlighting. Avoiding the much more common use of regular expressions on a line-by-line basis brings significant benefits. These benefits include improved responsiveness, lower CPU load, improved code maintainability and full integrity for syntax highlighting.

Auto-completion is available for XSLT and XPath, this includes contex-aware completion items for all code symbol names. XSLT and XPATH function signatures and descriptions are shown in the description alongside function completion items.

This extension performs a comprehensive set of checks on the code, before any XSLT compilation. Thsese checks ensure that any code symbols within XSLT or XPath with problems are accurately identified at the symbol-level. Asynchronous processing for xsl:include/xsl:import dependencies allows checking of references to symbol definitions regardless of the location of the definition.

## Running XSLT

![xslt-tasks](xslt-tasks.png)

XSLT transforms are configured and run as special VSCode Tasks. For more detail, see [XSLT Tasks](https://github.com/DeltaXML/vscode-xslt-tokenizer/wiki/XSLT-Tasks)

## Release Notes

See: [Release Notes](https://github.com/DeltaXML/vscode-xslt-tokenizer/wiki/Release-Notes) on the project wiki

## Sample Screenshots

See: [XSLT/XPath Wiki](https://github.com/DeltaXML/vscode-xslt-tokenizer/wiki/)

## Extension Settings

See: [VSCode Settings](https://code.visualstudio.com/docs/getstarted/settings)

### XSLT Tasks

To use the task-provider for the _Java_ Saxon XSLT Processor, the following setting is required (alter path to suit actual jar location):

```
  "XSLT.tasks.saxonJar": "/path/to/folder/SaxonHE10-0J/saxon-he-10.0.jar"
```

The Saxon XSLT-Java and XSLT-JS TaskProviders are enabled by default. These can be enabled/disable using the following settings properties:

```
"XSLT.tasks.java.enabled": true
"XSLT.tasks.js.enabled": true
```

### XSLT Packages

If your XSLT contains xsl:use-package instructions, XSLT package names are resolved to lookup symbols to support the following features:

- Goto Definition
- Symbol Diagnostics
- Symbol Auto-Completion

 To allow XSLT package names to be resolved to file paths, package details should be added to the setting:

`XSLT.resources.xsltPackages`

An example of XSLT package name settings:

```json
"XSLT.resources.xsltPackages": [
       { "name": "example.com.package1", "version": "2.0", "path": "included1.xsl"},
       { "name": "example.com.package2", "version": "2.0", "path": "features/included2.xsl"},
       { "name": "example.com.package3", "version": "2.0", "path": "features/not-exists.xsl"}
]
```

If file paths are relative they are resolved from the first Visual Studio Code Workspace folder

*Note: Currently, XSLT Package versions are not used in package-name lookup*

## Formatting

### VSCode Formatting Command Keyboard Shortcuts
1. *On Windows* - ```Shift + Alt + F```.
2. *On Mac* - ```Shift + Option + F```.
3. *On Ubuntu* - ```Ctrl + Shift + I```.

### Editor Settings for Highlighting in Color Theme Extensions

Syntax highlighting is currently only enabled by default in VSCode's built-in themes. This is because some extension themes may not yet have specific language support for VSCode's 'Semantic Highlighting' as used by this extension.

To enable syntax highighting for a custom theme you need to change User Settings. For example, to enable syntax highlighting for XSLT in the *City Lights* theme use:
```json
{
    "editor.semanticTokenColorCustomizations":{
      "[Monokai +Lights]": {"enabled": true}
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
    "editor.defaultFormatter": "deltaxml.xslt-xpath",
    "editor.formatOnSave": true,
    "editor.formatOnPaste": true,
    "editor.formatOnType": true
  }
}
```
### Editor Settings For Word Selection/Navigation

For word selection/navigation, by default, names like $two-parts are treated as two words for selection purposes and $ is also excluded from the name. This behaviour can be altered using the VSCode setting: 

`editor.wordSeparators`

See: [VSCode Documentation on Settings](https://code.visualstudio.com/docs/getstarted/settings)

For XSLT, keeping most of the default separator charators it is useful to disable `.` but enable `:` as word separators, as below:


  `~!@#%^&*()=+[{]}\|;'",:<>/?$


## Code Folding

Code-folding currently works by indentation indicating the nesting level. So, if code-folding does not work as expected, try reformatting using (for MacOS) - ```Shift + Option + F```.

**Region code-folding** is also supported. This can be useful, for example, for blocks of templates for a specific mode. To set a region code-folding block, surround it with `<?region?>` and `<?endregion?>` processing instructions. You may optionally include a label for the processing instructions, for example: 

```
  <?region reconstruct?>
    ...
  <?endregion reconstruct?>
```
___

## Support for other languages with embedded XPath

In addition to XSLT, other XML-based languages/vocabularies with embedded XPath will be supported in future in this extension. Currently, DeltaXML's [Document Comparison Pipeline (DCP)](https://docs.deltaxml.com/xml-compare/latest/dcp-user-guide-9340381.html) format is supported, acting as a pilot for other languages.

---
[<img src="deltaxmlLogo.png">](https://www.deltaxml.com/?utm_source=VisualStudio&utm_medium=Dev-Tools&utm_campaign=XSLT-XPATH)

_Project Sponsor Message:_

>DeltaXML specialise in management of change in structured content with products for XML and JSON compare and merge. Whether you are working with documents, data or code, DeltaXML’s products provide the most reliable, efficient and accurate comparison and merge functions for managing XML-based content. <p>Comprehensive API’s, configurable output formats and full audit trail capabilities make DeltaXML’s products perfect for integration with your current content management workflows or for embedding within existing editing and publishing products. <p>See our products and download an evaluation [here](https://www.deltaxml.com/?utm_source=VisualStudio&utm_medium=Dev-Tools&utm_campaign=XSLT-XPATH):
