---
name: schematron
description: Use to write, change, validate or debug Schematron schemas (.sch) and the XML they check - in a project where the "xslt-xpath" MCP server (the XSLT/XPath VS Code extension) is connected. Schemas are run with SchXslt2, with XSLT 3.0 or 4.0 as the query language. Covers the extension's Schematron checks, running a validation with the validation_configuration tool, reading the report, and testing a schema with XSpec.
---

# Schematron with the xslt-xpath MCP server

A schema is validated as SchXslt2 validates it: compiled to an XSLT stylesheet, which is run on the XML. The extension checks a schema as
you write it, and `validation_configuration` gives the command that validates a file with it, as Schematron: Validate does.

## Tools

| Tool | Use it to |
| --- | --- |
| `lint_file` / `lint_files` | Check a schema (`.sch`) with the extension's Schematron checks - **after every edit** |
| `validation_configuration` | Get the command that validates an XML file with a schema, and the command that summarises the report |
| `evaluate_xpath` | Try a rule's `context` or an assertion's `test` on the XML; turn a report's location into a line and column |
| `test_configuration` | Run a schema's XSpec tests (an `.xspec` file with a `schematron` attribute) |

## Workflow

1. **Know the XML.** `validation_configuration` says which XML file the schema is for. Try the `context` of a rule and the `test` of an assertion on it with
   `evaluate_xpath` before writing them.
2. **Write the schema,** then `lint_file` it and fix what it reports.
3. **Validate.** `validation_configuration` with the schema and the XML file (give the one it doesn't know as `pairedWith`; `phase` for a phase);
   run the command, then the summary command. The run exits with 0 whether or not assertions failed - read the summary, not the exit code.
4. **Find each problem.** The summary gives a location as an XPath with names written `Q{}name`: `evaluate_xpath` with it, on the XML file, gives the
   line and column.
5. **Say what happened:** the failed assertions and reports, which are expected and which need a fix, and what you changed.

## Writing a schema

- **Structure:** `sch:schema` holds `sch:pattern`s; a pattern holds `sch:rule`s, each with a `context`; a rule holds `sch:assert` (the problem when its `test` is
  false) and `sch:report` (the problem when its `test` is true), each with a message, and `id` and `role`. A `role` of `warning` or `info` sets the
  severity - otherwise it is an error.
- **A node is handled only by the first rule of a pattern whose context matches it.** A later rule with the same context, or after one for `*`, never
  fires - the linter reports it. Put the specific rule first, and independent checks in separate patterns.
- **Prefixes:** SchXslt2 declares only the prefixes of `sch:ns`. A prefix declared only with `xmlns` - `xs` in `xs:integer(@n)` - is an error: add
  `<sch:ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/>`.
- **Query language:** `queryBinding="xslt3"` (or `xslt4`). An XQuery binding isn't supported.
- **Variables:** `sch:let` in a schema or phase is global, in a pattern is in scope in its rules, in a rule in its assertions and reports.
- **XSLT in a schema:** only `xsl:function`, `xsl:key`, `xsl:accumulator`, `xsl:include`, `xsl:import`, `xsl:import-schema` and `xsl:use-package` are used. Other
  XSLT - `xsl:variable`, XSLT in a message - is ignored: use `sch:let`, and `sch:value-of` in a message.
- **Text value templates** (`{@id}`) in a message are not standard Schematron: they work only with the `XSLT.schematron.allowExpandText` setting, which
  `validation_configuration` says is on. Prefer `sch:value-of`.
- **ids** should be unique: XSpec tests refer to an assertion by its `id`.

## Reading a report

- The summary has the numbers of failed assertions and successful reports, then each with `[role]`, its location, the message, its `test` and `id`.
- A rule that never fires usually has a `context` that doesn't match the XML - or an earlier rule matched first. Check the context with `evaluate_xpath`.
- If the command itself fails, the message from Saxon or SchXslt2 says why - an error in an XPath of the schema, a file that isn't found. `lint_file`
  usually reports it first.
- The validation uses the saved files.

## Testing the schema

An XSpec file with `schematron="rules.sch"` tests a schema: see the `xspec-testing` skill, and run it with `test_configuration`.
