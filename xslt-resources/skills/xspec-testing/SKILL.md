---
name: xspec-testing
description: Use to write, change, run or debug XSpec tests (.xspec files) - for an XSLT stylesheet, an XSLT package or a Schematron schema - in a project where the "xslt-xpath" MCP server (the XSLT/XPath VS Code extension) is connected. Covers writing scenarios, running them with the test_configuration tool, reading the results, and what to do when a test fails. For writing the XSLT itself, use the xslt-xpath skill.
---

# XSpec tests with the xslt-xpath MCP server

XSpec tests are run by the extension as a few Saxon steps, with options it works out for the user's setup. Don't write your own
command: `test_configuration` gives the commands, and a command that summarises the result.

## If the tools aren't there

This skill's tools come from the `xslt-xpath` MCP server, which the user's VS Code runs for the project open in its window. If none of
them is available - e.g. `lint_file` can't be found - **stop and tell the user** before working without them: the server isn't
connected for this project. To connect it:

1. In VS Code, turn on the setting **XSLT.mcp.enabled** (a user setting), with this project's folder open in the window.
2. In that window, run **XSLT: Set Up MCP Server for Claude Code**, for this project or all projects.
3. Start a new Claude Code session here: its tools are loaded when a session starts (`/mcp` lists the servers connected).

If the user wants you to go on without them, say what you can't check - the linter, the user's Saxon set-up, the extension's test and
run commands - rather than guessing those commands.

## Tools

| Tool | Use it to |
| --- | --- |
| `find_references` | See which scenarios already test a function or named template - listed last, under "Tested in XSpec" - before writing more |
| `list_declarations` / `find_declaration` | See what there is to test: each function's or template's parameters and types |
| `lint_file` | Check the `.xspec` file against XSpec's schema, the stylesheet it tests and its XPath variables - **after every edit** |
| `test_configuration` | Get the commands that compile and run the file's tests, and the command that summarises the result |
| `evaluate_xpath` | Check what an expression selects in the test's XML, before it goes in `x:context` or an expectation |

## Workflow

1. **Find what to test and what's tested.** `find_declaration` for the signature; `find_references` for existing scenarios; read the
   `.xspec` file. Add to its scenarios; don't write a second copy of one.
2. **Write the scenarios** (below), then `lint_file` the `.xspec` file and fix what it reports.
3. **Run them.** `test_configuration` for the file, then its **In one line** command, in a shell (the user may be asked to allow it):
   the steps, then the summary. The runs exit with 0 whether or not tests failed - read the summary, not the exit code. **Before
   fixing the stylesheet**, run the tests once to see which fail - they confirm the cause, and show the fix makes them pass.
4. **When a test fails, decide which is wrong** - the stylesheet or the expectation - from the expected and actual values. Don't change an
   expectation just to make it pass without telling the user why. If the stylesheet is wrong, say so, and fix it only if that's the task.
5. **Say what happened:** the numbers passed, failed and pending, each failure, and what you changed.

## Writing scenarios

- **A function:** `x:call function="f:area"`, with an `x:param` for each parameter **in order** (give `as` where the type matters).
- **A named template:** `x:call template="f:heading"`, with an `x:param name="text"` for each parameter by name. A tunnel parameter can't be
  passed by `x:call`.
- **A template rule:** `x:context` (with `mode="..."` for a rule in a mode) containing an element the rule matches.
- **The expectation.** `select` on `x:expect` is the *expected value*, which XSpec compares with the result; for an expected node or
  element, put it as the content of `x:expect`. `test` is a boolean XPath that can use `$x:result`, e.g. `test="$x:result eq 4"`. Don't write
  `$x:result` in `select` - that compares the result with itself or a boolean; the linter warns and offers to change it to `test`.
- **Labels** say what happens: "a line of 10 items has a 10% discount", not "test 2".
- **Setup:** `x:variable` and `x:param` hold test data; `x:param` on `x:description` sets a global parameter of the stylesheet - one with
  `required="yes"` that isn't set makes every test fail with XTDE0050. `x:like` reuses a shared scenario.
- **`pending="reason"`** skips a scenario or expectation: leave the user's pending tests as they are.
- **Namespaces:** declare on `x:description` the prefixes the names use - `xs` and the stylesheet's own.

## A package, or a stylesheet that uses one

By default XSpec **imports** the stylesheet into its test runner. An `xsl:package` can't be imported, and nor can a stylesheet with an
`xsl:use-package` at its top level - or in a module it includes or imports: Saxon stops the run with XTSE3008. The linter reports both, on
the `stylesheet` attribute, so a test that's reported will not run.

- **To test a package itself:** `run-as="external"` on `x:description`, with `stylesheet` the package: it's run as a separate transformation,
  so only `x:call` reaches its public components - not an XPath expression in the XSpec file. Or an `x:helper package-name="..."` (with
  `package-version`) and a `stylesheet` that does nothing: the runner uses the package, so its public functions can be called in XPath
  expressions too.
- **To test a stylesheet that uses a package:** keep the `xsl:use-package` out of what is tested. Put it in a top-level stylesheet, test the module
  that has the logic, and give the runner the package with `x:helper package-name="..."` on `x:description`. Don't reach for
  `run-as="external"`: with Saxon-PE 13.1 the separate transformation didn't find the package passed with `-lib` (XTSE3000).

Calling a component that isn't public is reported. The tools pass the packages to Saxon with `-lib`.

## Testing a Schematron schema

`x:description schematron="rules.sch"` (only a schema with an XSLT query binding, e.g. `queryBinding="xslt3"`). `x:context` holds the XML to
validate, and the expectations are `x:expect-assert id="..."`, `x:expect-not-assert`, `x:expect-report`, `x:expect-not-report` and `x:expect-rule`.
Their ids must be ones the schema has: the linter reports one it doesn't, as that expectation would always fail (or, for `-not-`, always pass).
`test_configuration` adds the steps that compile the schema first. See the `schematron` skill for the schema itself.

## Reading a result

- The summary gives the numbers and each failure as `scenario > expectation`, with `expected:` and `actual:` - cut short if long; the full result is
  the XML file `test_configuration` names.
- A test that doesn't compile or run shows Saxon's message from the step that failed - an XPath error in a `test`, a missing stylesheet - not a
  summary. Fix it and run all the steps again.
- Tests run on the saved files. The Test Explorer in VS Code isn't updated by your runs.
- To run one scenario, ask the user to run it from the Test Explorer: the commands run the whole file.
