---
name: xslt-xpath
description: Use for any task that writes, edits, refactors, debugs or explains XSLT (.xsl, .xslt), XSpec (.xspec) or XPath - including XSLT 3.0 and 4.0 - in a project where the "xslt-xpath" MCP server (the XSLT/XPath VS Code extension) is connected. Gives the workflow and the tools to check work with the same linter and Saxon setup the user has.
---

# XSLT and XPath with the xslt-xpath MCP server

The server's tools use the user's VS Code extension: its linter, its knowledge of the stylesheet's imports, includes and
packages, and the user's Saxon jar. Prefer them to guessing - a stylesheet that passes `lint_file` and runs is better evidence
than one that looks right.

## Tools

| Tool | Use it to |
| --- | --- |
| `list_declarations` | See every function, named template, variable, mode, key, item type... a module can use - **before writing**, to reuse what exists |
| `find_declaration` | Read one declaration's parameters, types and documentation (its `xsl:note`, or a comment above it) |
| `find_references` | Find every use of a component, including the XSpec scenarios that test it - **before changing or renaming** it |
| `module_imports` | See the import/include/package tree and import precedence |
| `lint_file` / `lint_files` | Check one module, or a folder, as the Problems view does - **after every edit** |
| `evaluate_xpath` | Try an XPath expression on the stylesheet's source XML before relying on it |
| `xpath_function` | Look up a built-in function's signature, for XPath 3.1 or 4.0 |
| `describe_type` | Read an XSLT 4.0 record or enumeration item type |
| `run_configuration` | Get the user's Saxon jar and edition, XML context file, parameters, catalog, packages - and the exact command that runs a stylesheet or XSpec test |

The tools only read. You edit files yourself, and run Saxon yourself with the command `run_configuration` gives (the user may be
asked to allow it).

## Workflow

1. **Find the XSLT version.** Check the stylesheet's `version` attribute (or `lint_file` on a neighbour). Never raise it unless asked,
   and don't use 4.0 syntax in a 3.0 stylesheet. For a 4.0 function, check `xpath_function` with `xpathVersion: "4.0"`.
2. **See what exists.** `list_declarations` for the module; `find_declaration` for the ones you may call. Reuse; don't write a
   second copy of a function that's already imported.
3. **Check an XPath on real input.** `run_configuration` names the XML context file; `evaluate_xpath` on it for a `select`,
   a `test` or a match pattern. See the notes below on namespaces.
4. **Edit, then lint.** Run `lint_file` after each change and fix what it reports before moving on. For a module that another
   stylesheet imports or includes, lint it with its top-level stylesheet's declarations (it finds the one in the workspace; give
   `topLevelStylesheet` for another). Use `lint_files` after a change that touches several modules.
5. **Run it.** Get the command from `run_configuration` for the stylesheet and run it, rather than writing your own Saxon
   command - the options (`--allowSyntaxExtensions:on` for 4.0, `-catalog`, `-lib` for packages) matter.
6. **Test it.** If there are XSpec tests, `find_references` shows the scenarios for a function or template; update them with
   the change and run them with the XSpec command from `run_configuration`. For new logic, add a scenario.

## Reading the linter

- **A warning for a name it can't find** means the module imports or includes something that isn't found or can't be resolved
  (e.g. an `_href` it can't evaluate) - the name may be declared there. Fix the import first.
- **Errors in an included module** may only be errors on their own: lint it with its top-level stylesheet.
- **Package visibility:** a component that's private (or not exposed or accepted) in a package is reported where it's used.
  Don't make it `public` just to silence the error without asking - that changes the package's interface.
- The linter is not a compiler: it checks names, types it can see, and XSLT rules, but Saxon has the last word. A clean lint
  and a failing run means: read Saxon's error code and the line it gives.

## Using evaluate_xpath

- It evaluates **as a stylesheet does**: an unprefixed element name is in no namespace, whatever the document's default
  namespace. If the stylesheet sets `xpath-default-namespace`, pass it as `xpathDefaultNamespace`. An empty result on a document
  with a default namespace says so.
- Prefixes the document declares are bound. For others, put `declare namespace p = 'urn:x';` lines first (one per prefix, each
  ending in `;`) - this is **not XQuery**: nothing else is allowed before the XPath.
- `xs`, `fn`, `map`, `array`, `math` and `err` are predeclared in the tool - but **the stylesheet must declare `map`, `array` and
  `math` itself** (`xmlns:map="http://www.w3.org/2005/xpath-functions/map"`, ...). Check this when moving an expression over.
- No Java or EXPath extension functions, no `collection()`, and `doc()` / `unparsed-text()` only read the workspace. `saxon:` functions
  need Saxon-PE or EE (not HE). Nodes are listed with the line and column where they start.
- XPath 4.0 by default; Saxon-HE can only evaluate 3.1, and the result says so.

## XSLT habits that avoid common errors

- Declare `xmlns:xs`, `xmlns:map`, `xmlns:array` and `xmlns:math` where used, and `exclude-result-prefixes` for the ones the
  output shouldn't have. A stylesheet function needs a name in a namespace of your own (`xmlns:f="urn:..."`): the `local:` prefix
  isn't predeclared in XSLT. The linter reports an undeclared prefix - declare it, don't remove the call.
- A global variable or parameter that uses the context item (`select="/"`, `select="."`) fails with XPDY0002 when there's no
  context item - e.g. under XSpec or a named initial template. **The linter doesn't report this**, so check for it yourself:
  evaluate it inside a template, or pass it as a parameter.
- Use `as` on parameters and functions; for an optional parameter, `as="xs:string?"` with `select="()"`.
- In XPath written anywhere in XML - an attribute (`test`, `select`, `match`, an attribute value template), a `{...}` in text, or
  the content of an XSLT 4.0 `xsl:select` element - a literal `<` is not allowed by XML: write `&lt;` (and `&lt;=`), or in element
  content put the expression in a CDATA section. `>` is fine as it is, and `&` needs `&amp;`. `&lt;` is still the general comparison - don't swap
  it for `lt` to avoid the escape: `lt`, `gt` and the other value comparisons are for operands you know are single items (they
  raise an error on a sequence, and compare differently), not a spelling of `<`.
- Regular expressions (`matches`, `replace`, `tokenize`, `analyze-string`) are fine in XSLT 2.0 and later - use them where they're the
  right tool.
- **XSLT 4.0 features depend on the user's Saxon.** Saxon 13 supports much of 4.0 with `--allowSyntaxExtensions:on` (PE/EE) but
  not all - for example `xsl:record` and `xsl:record-type` aren't supported. If the linter accepts something and Saxon rejects
  it, believe Saxon, and say so to the user.
- Keep module-level changes small: one concern per stylesheet, and don't reformat parts of a stylesheet you weren't asked to change.

## What to tell the user

After a change, say what you linted (and its result), what you ran (and the output or error), and which XSpec scenarios you ran
or added. If a tool wasn't available - no Saxon jar set, `evaluate_xpath` without a source XML - say what you couldn't check.
