[<img src="deltaxigniaLogoSmall.png">](https://www.deltaxml.com/?utm_source=VisualStudio&utm_medium=Dev-Tools&utm_campaign=XSLT-XPATH)
# XSLT/XPath for Visual Studio Code

The XSLT/XPath extension for VS Code provides comprehensive language support for XSLT 3.0 and XPath 3.1, and for the XSLT 4.0 and XPath 4.0 features implemented in Saxon 13.

The aim is to make writing, reviewing and debugging XSLT easier. The extension understands each XPath expression - which names are variables, functions or node tests, and where each is declared, including in imported modules - so problems show as you type, and you can go from any name to its declaration, rename it safely, or step through the expression in the debugger.

**Getting started:**

1. Install the extension and open an XSLT file - editing, highlighting and linting need no setup.
2. To run or debug stylesheets, set `XSLT.tasks.saxonJar` to the path of your Saxon jar (Saxon-HE is fine), with a Java runtime on the PATH.
3. Press **Quick Run** (`⌘⌥R` / `Ctrl+Alt+R`) to run the stylesheet with the XML file you last had open - shown in the status bar, where you can pick another.

See the [XSLT/XPath User Guide](https://deltaxml.github.io/vscode-xslt-xpath/) for the full description of each feature.

---

<p align="center">
  <em>Debugging XSLT with SaxonJ: paused within an XPath expression, with its range variable,<br> the context and global variables, inline values and the call stack:</em>
  <img alt="XSLT Debugger" src="debugger-xpath-step.jpg">
</p>



# Features

The [step-through XSLT debugger](https://deltaxml.github.io/vscode-xslt-xpath/debugger.html) for SaxonJ sets breakpoints and steps through templates, functions and multi-line XPath expressions - including inline functions passed to functions such as `fold-left` - showing variables and the context item as you go.


<table>
<tr>
  <td width="50%" valign="top">
    <h4><a href="https://deltaxml.github.io/vscode-xslt-xpath/xslt40.html">XSLT &amp; XPath languages</a></h4>
    <ul>
      <li><a href="https://www.w3.org/TR/xslt-30/">XSLT 3.0</a> and XPath 3.1</li>
      <li><a href="https://qt4cg.org/2026-01-28/xslt-40/Overview.html">XSLT 4.0</a> and XPath 4.0, as in 
      <a href="https://www.saxonica.com/html/documentation13/changes/v13/xslt40.html">Saxon 13</a></li>
      <li>SaxonJS interactive extensions (IXSL)</li>
      <li><code>.xpath</code> files, as XPath 4.0</li>
      <li>Fast semantic highlighting</li>
    </ul>
  </td>
  <td width="50%" valign="top">
    <h4><a href="https://deltaxml.github.io/vscode-xslt-xpath/xslt40-records.html">XSLT 4.0</a></h4>
    <ul>
      <li>Record and enum types, with type-aware checks</li>
      <li>Named item types: <code>xsl:item-type</code></li>
      <li><code>xsl:switch</code>, with missing-case quick fixes</li>
      <li>Keyword arguments and optional parameters</li>
      <li>Functions in no namespace</li>
    </ul>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <h4><a href="https://deltaxml.github.io/vscode-xslt-xpath/editing-xslt.html#intellisense">Editing</a></h4>
    <ul>
      <li>Context-aware auto-completion, incl. node names</li>
      <li>Signature help and hover help</li>
      <li>Snippets, incl. new stylesheets for 3.0 and 4.0</li>
      <li>Formatting of instructions and multi-line XPath</li>
      <li>Rename symbol, across imported modules</li>
      <li>Semantic highlighting from a full XPath parser</li>
      <li>Code actions for Quick-Fix and Refactoring</li>
    </ul>
  </td>
  <td width="50%" valign="top">
    <h4><a href="https://deltaxml.github.io/vscode-xslt-xpath/debugger.html">Debugging</a></h4>
    <ul>
      <li>Step-through <a href="https://deltaxml.github.io/vscode-xslt-xpath/debugger.html">XSLT debugger</a> (SaxonJ)</li>
      <li>Per-line tracing of multi-line XPaths</li>
      <li>Conditional Breakpoints or Logpoints</li>
      <li>Views for globals, locals, context and output</li>
      <li>Watch expressions and debug console</li>
      <li>Output node mapping to its XSLT origin</li>
      <li>Formatted and colorised print debugging</li>
    </ul>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <h4><a href="https://deltaxml.github.io/vscode-xslt-xpath/editing-xslt.html#checking">Linter</a></h4>
    <ul>
      <li>XPath syntax and XSLT instructions</li>
      <li>Types, records, enums and function arguments</li>
      <li>Unused XSLT and XPath variables or parameters</li>
      <li>References across imported modules</li>
      <li>Saxon errors from runs, in the Problems panel</li>
      <li>Quick fixes for common problems</li>
    </ul>
  </td>
  <td width="50%" valign="top">
    <h4><a href="https://deltaxml.github.io/vscode-xslt-xpath/navigation.html">Navigation</a></h4>
    <ul>
      <li>Go to (or peek) definition, and find references</li>
      <li>Go to the declarations of record fields</li>
      <li>Outline, breadcrumbs and Go to Symbol</li>
      <li>Links for <code>xsl:import</code> and <code>xsl:include</code></li>
      <li>XSLT Imports view, with inferred top-level stylesheets</li>
      <li>Filterable dropdown listing all symbols and modes</li>
    </ul>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <h4><a href="https://deltaxml.github.io/vscode-xslt-xpath/refactoring-xslt.html">Refactoring</a></h4>
    <ul>
      <li>Context-aware with safe symbol renaming</li>
      <li>Extract <code>xsl:function</code> or <code>xsl:template</code></li>
      <li>Extract <code>xsl:variable</code> from an XPath expression</li>
      <li>Extract a record type from a map</li>
      <li><strong>Wrap with...</strong> an instruction (<code>⌥⇧W</code> / <code>Alt+Shift+W</code>)</li>
      <li>Add a documentation note</li>
    </ul>
  </td>
  <td width="50%" valign="top">
    <h4><a href="https://deltaxml.github.io/vscode-xslt-xpath/quick-run.html">Running XSLT</a></h4>
    <ul>
      <li><strong>Quick Run</strong> (<code>⌘⌥R</code> / <code>Ctrl+Alt+R</code>)</li>
      <li>Tasks for SaxonJ, SaxonJS and SaxonC</li>
      <li>Required <code>xsl:param</code> values asked for when a task runs</li>
      <li><code>xsl:param</code> values controlled by tasks</li>
      <li>XML catalogs for <code>xsl:import</code> URIs</li>
      <li>File pickers for task inputs</li>
    </ul>
  </td>
</tr>
<tr>
 <td width="50%" valign="top">
    <h4><a href="https://deltaxml.github.io/vscode-xslt-xpath/xslt40-notes.html">Code documentation</a></h4>
    <ul>
      <li><code>xsl:note</code> with Markdown and xqDoc-style tags</li>
      <li>Shown in hover and signature help</li>
      <li><code>@see</code> references, with navigation and rename</li>
      <li>Checks of <code>@param</code> and <code>@field</code> tags</li>
      <li>Module notes for stylesheets</li>
      <li>Highlighting and auto completion for tags or references</li>
    </ul>
  </td>
  <td width="50%" valign="top">
    <h4><a href="https://deltaxml.github.io/vscode-xslt-xpath/editing.html">XML editing</a></h4>
    <ul>
      <li>Well-formedness and namespace checks</li>
      <li>Formatting and tree-view outline</li>
      <li>Auto tag-close, tag rename and self-close</li>
      <li>Comment command (<code>⌘/</code>)</li>
      <li>XML snippets</li>
      <li>Breadcrumb Navigation</li>
      <li>Sticky scroll view</li>
    </ul>
  </td>
</tr>
</table>

\* *Problem-reporting currently depends on the VSCode symbol-provider. To ensure problems are always reported in VSCode, use the following VSCode setting: `"breadcrumbs.enabled": true`*

<p align="center">
  <em>XSLT 4.0 with a documentation note, its hover help where the function is called, and the XSLT Imports view:</em>
  <img alt="XSLT Editor" src="vscode-xslt-notes.png">
</p>

# XML Commands

The XML selection commands are also in the **XML Selection** submenu of the editor's context menu (right-click), and in the **XML: Select Element...** quick pick (`⇧⌘2` / `Ctrl+Shift+2`) - both show their key-bindings.

| Command  | Key-Binding (macOS / Windows, Linux) | Details |
| ------- | ------- | --------- |
| XML: Find Nodes with XPath... |  | Opens the XPath query file below the XML file |
| XML: Add XPath Location to Queries | ⌥G / Alt+G | Adds the location of the node at the cursor to the XPath query file |
| XML: Select Element... | ⇧⌘2 / Ctrl+Shift+2 | Quick pick of the XML selection commands, and the XPath query commands |
| XML: Select current element | ⇧⌘0 / Ctrl+Shift+0 | Includes start/end tags |
| XML: Select parent element | ⇧⌘9 / Ctrl+Shift+9 | Includes start/end tags |
| XML: Select first child element | ⇧⌘8 / Ctrl+Shift+8 | Includes start/end tags |
| XML: Select following element | ⇧⌘7 / Ctrl+Shift+7 | Includes start/end tags |
| XML: Select preceding element | ⇧⌘6 / Ctrl+Shift+6 | Includes start/end tags |
| New XPath Notebook | - | DeltaXignia's [XPath Notebook extension](https://marketplace.visualstudio.com/items?itemName=deltaxml.xpath-notebook) is required

 # Introduction
 
For lexical analysis, this extension processes code character-by-character, and every feature - including *all* syntax highlighting - uses the result. This keeps editing responsive, and the highlighting accurate even in long, multi-line XPath expressions.

**Auto-completion** is provided for XSLT and XPath. This includes context-aware completion items for all code symbol names. XSLT and XPath function signatures and descriptions are shown in the description alongside function completion items. The last active non-XSLT file is used as the source to compute available node names for XPath location steps.

This extension's linter performs a comprehensive set of checks on the code. The linter ensures that any code symbols within XSLT or XPath with problems are accurately identified at the symbol-level. Asynchronous processing for xsl:include/xsl:import dependencies allows checking of references to symbol definitions regardless of the location of the definition.

# Running XSLT

![Quick Run](quick-run.png)

*(1) XSLT in active editor, (2) the Saxon processor, (3) the XML context file - click the play button to run*

The quickest way to run the stylesheet in the active editor is [Quick Run](https://deltaxml.github.io/vscode-xslt-xpath/quick-run.html) (`⌘⌥R` / `Ctrl+Alt+R`): the first run creates a task for you, which later runs reuse.

XSLT transforms for SaxonJ, SaxonJS and SaxonC are configured and run as special VS Code tasks. 

XSLT task JSON properties can reference special commands. The special commands allow file-selection via a File Explorer or 'Recent Files' list, an example using: `"xsltFile": "${command:xslt-xpath.pickXsltFile}"`. The **XSLT: Add XSLT Inputs to Tasks File** command adds inputs for file-selection prompts to `tasks.json`. A sample screenshot is shown below:

![xslt-tasks](xslt-tasks-file.png)

For a full description of using VS Code tasks to run XSLT, see [Running XSLT](https://deltaxml.github.io/vscode-xslt-xpath/run-xslt.html).

## Debugging XSLT

Stylesheets can be debugged with SaxonJ (Saxon 12 or later, any edition, including Saxon-HE): set breakpoints in the stylesheet, then use **XSLT: Debug Stylesheet with SaxonJ** (the debug button in the editor title, or `F5` with no `launch.json`). The stylesheet runs as Quick Run runs it - with the XML context file, or from `xsl:initial-template` - using the Quick Run task's settings.

Where Saxon's standard tracing stops at XSLT instructions, this debugger uses Saxon's own APIs to inject extra trace points and re-parse XPath to locate sub-expressions, so it can stop deep inside multi-line expressions and inline functions.

- Line breakpoints, with conditions, hit counts and logpoints (`{$*}` in a logpoint's message logs the local variables) - and function breakpoints, for stylesheet functions and named templates
- Step Over, Step Into and Step Out - including line by line through multi-line XPath expressions, and into inline functions
- Local and global variables, the context item, `current-group()` and `regex-group()` - and their values inline, while paused
- XPath evaluation in the Watch view, the Debug Console and on hover, where execution is paused
- Pausing on dynamic errors, and the output written so far

See [XSLT Debugger](https://deltaxml.github.io/vscode-xslt-xpath/debugger.html) in the User Guide for the full description - including `launch.json` configurations, limitations and troubleshooting.

# Release Notes

The project changelog is maintained on the project wiki. See [Release Notes](https://github.com/DeltaXML/vscode-xslt-tokenizer/wiki/Release-Notes).

# Extension Settings

Editing and linting need no settings. Running and debugging stylesheets need the path of a Saxon processor (see below).
This section outlines the main settings associated with XSLT features.

For more details on how these settings are managed within VS Code see: [VS Code Settings](https://code.visualstudio.com/docs/getstarted/settings)

## XSLT Tasks

To use the task-provider for the _Java_ Saxon XSLT Processor, the following setting is required (alter path to suit actual jar location):

```
  "XSLT.tasks.saxonJar": "/path/to/folder/SaxonHE12-9J/saxon-he-12.9.jar"
```

To use the task-provider for SaxonC, set the path of the folder containing the SaxonC command-line `Transform` executable:

```
  "XSLT.tasks.saxonCPath": "/path/to/folder/containing/Transform"
```

## XSLT 4.0 Tasks

XSLT 4.0 requires Saxon-PE or Saxon-EE (or the equivalent SaxonC edition). The task property `allowSyntaxExtensions40` defaults to `"auto"`, which enables XPath 4.0 syntax unless the processor is Saxon-HE.

When the `parse-html()` function is used, the following setting is also needed, e.g.:

```
  "XSLT.tasks.htmlParserJar": "/path/to/folder/htmlparser-1.4.jar" // or: nu.validator.jar
```

## XSLT Packages

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

This extension supports special XSLT code formatting. This can be invoked with a VS Code command and/or as you type, depending on your settings.

### VS Code Formatting Command Keyboard Shortcuts
1. *On Windows* - ```Shift + Alt + F```.
2. *On Mac* - ```Shift + Option + F```.
3. *On Ubuntu* - ```Ctrl + Shift + I```.

### Recommended Editor Settings For Formatting etc.

You should start with something like the following in the `settings.json` file: 
```json
{
  ...
  "[xslt]": {
        "editor.formatOnPaste": true,
        "editor.formatOnSave": false,
        "editor.formatOnSaveMode": "modifications",
        "editor.formatOnType": true,
        "editor.defaultFormatter": "deltaxml.xslt-xpath",
        "editor.detectIndentation": true,
        "editor.tabSize": 2,
        "editor.wordSeparators": "`~!@#$%^&*()=+[{]}\\|;:'\",.<>/?",
        "outline.showArrays": true,
        "breadcrumbs.showArrays": true,
        "editor.semanticHighlighting.enabled": true
  }
  ...
}
```

## Refactoring
A range of [code refactoring](https://deltaxml.github.io/vscode-xslt-xpath/refactoring-xslt.html) features are supported, including **Rename Symbol**, **Extract Function** and, for XSLT 4.0, **Extract record type**. 

When XSLT code is refactored, instructions and expressions are revised when necessary to
ensure the code behaviour remains unchanged. For example, the **Extract Function** refactor revises all expressions requiring the context-item so the code compiles and runs as before.

## Editor Settings for Highlighting in Color Theme Extensions

Syntax highlighting is currently only enabled by default in VS Code's built-in themes. This is because some extension themes may not yet have specific language support for VS Code's 'Semantic Highlighting' as used by this extension.

To enable syntax highlighting for a custom theme you need to change User Settings. A set of dark color themes, specially enhanced
for XSLT, are provided by the [XSLT Dark Themes](https://marketplace.visualstudio.com/items?itemName=deltaxml.xslt-dark-themes) extension. 

You can also customize
XSLT token colors. For example, to enable syntax highlighting for XSLT and add some customizations in the [Gruvbox Material Dark](https://marketplace.visualstudio.com/items?itemName=sainnhe.gruvbox-material) theme you could use:
```json
  "editor.semanticTokenColorCustomizations": {
    "[Gruvbox Material Dark]": {
      "enabled": true,
      "rules": {
        "xmlPunctuation": "#b75a1e",
        "anonymousFunction": "#d3869b",
        "xmlText": "#928374",
        "attributeNameTest": "#89b482",
        "elementName": "#d3869b"
      },
    }
  },
  ```

Or, to enable syntax highlighting for all themes:

```json
  "editor.semanticHighlighting.enabled": true,
  ```

## Editor Settings For Word Selection/Navigation

As in XPath, a name like `$two-parts`, `f:line-total` or `xsl:value-of` is one word for completion, the debugger's hovers, highlighting its other occurrences and finding it (e.g. `Cmd+D` / `Ctrl+D`).

For word selection and navigation (e.g. double-click, or `Alt`/`Ctrl` + arrow keys), the extension's default `editor.wordSeparators` setting keeps names like `two-parts` together, but separates `$` and a prefix's `:`. This behaviour can be altered using the VS Code setting:

`editor.wordSeparators`

See: [VS Code Documentation on Settings](https://code.visualstudio.com/docs/getstarted/settings)

## Code Folding

Code-folding currently works by indentation indicating the nesting level. So, if code-folding does not work as expected, try reformatting using (for MacOS) - ```Shift-⌥-F```.

**Region code-folding** is also supported. This can be useful, for example, for blocks of templates for a specific mode. To set a region code-folding block, surround it with `<?region?>` and `<?endregion?>` processing instructions. You may optionally include a label for the processing instructions, for example: 

```
  <?region reconstruct?>
    ...
  <?endregion reconstruct?>
```
___

# XSLT/XPath User Guide

The [XSLT/XPath User Guide](https://deltaxml.github.io/vscode-xslt-xpath/) provides an introduction to features supported by this extension for XSLT and XPath developers.

The main documentation pages are linked below:

- [Overview](https://deltaxml.github.io/vscode-xslt-xpath/index.html)
- [Release 2.0 Highlights](https://deltaxml.github.io/vscode-xslt-xpath/new-release.html)
- [Editing XML](https://deltaxml.github.io/vscode-xslt-xpath/editing.html)
- [Editing XSLT/XPath](https://deltaxml.github.io/vscode-xslt-xpath/editing-xslt.html)
- [Code Navigation](https://deltaxml.github.io/vscode-xslt-xpath/navigation.html)
- [Quick Run](https://deltaxml.github.io/vscode-xslt-xpath/quick-run.html)
- [Running XSLT](https://deltaxml.github.io/vscode-xslt-xpath/run-xslt.html)
- [XSLT Debugger](https://deltaxml.github.io/vscode-xslt-xpath/debugger.html)
- [Debugging with xsl:message](https://deltaxml.github.io/vscode-xslt-xpath/code-diagnostics.html)
- [Settings](https://deltaxml.github.io/vscode-xslt-xpath/settings.html)
- [XSLT 4.0](https://deltaxml.github.io/vscode-xslt-xpath/xslt40.html)
- [Records and Enums](https://deltaxml.github.io/vscode-xslt-xpath/xslt40-records.html)
- [Code Documentation](https://deltaxml.github.io/vscode-xslt-xpath/xslt40-notes.html)
- [XML Catalogs](https://deltaxml.github.io/vscode-xslt-xpath/xml-catalogs.html)

---


## Support for other languages with embedded XPath

In addition to XSLT, XPath embedded in these XML vocabularies is highlighted, checked and auto-completed:

- Schematron (`.sch`) - basic support, for the XPath in attributes such as `context` and `test`
- DeltaXignia's [Document Comparison Pipeline (DCP)](https://docs.deltaxml.com/xml-compare/latest/dcp-user-guide-9340381.html) format (`.dcp`)

---
_Project Sponsor Message:_

[<img src="deltaxigniaLogo.png" style="width: 300px">](https://www.deltaxml.com/?utm_source=VisualStudio&utm_medium=Dev-Tools&utm_campaign=XSLT-XPATH)

>DeltaXignia specialise in management of change in structured content with solutions including XML and JSON compare and merge. Whether you are working with documents, data or code, DeltaXignia’s solutions provide the most reliable, efficient and accurate comparison and merge functions for managing structured content. <p>Comprehensive API’s, configurable output formats and full audit trail capabilities make DeltaXignia’s products perfect for integration with your current content management workflows or for embedding within existing editing and publishing products.
