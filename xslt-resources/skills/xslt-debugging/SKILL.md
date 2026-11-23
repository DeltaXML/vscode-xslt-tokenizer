---
name: xslt-debugging
description: Use to find why an XSLT stylesheet's output is wrong, missing or has stray text, to see variable values and which templates run while it runs, to use the user's paused VS Code debug session, or to find why a transformation is slow - in a project where the "xslt-xpath" MCP server (the XSLT/XPath VS Code extension) is connected. Covers output_origin, input_rules, trace_configuration, debug_status, debug_evaluate and profile_configuration. For writing and checking the XSLT, use the xslt-xpath skill.
---

# Debugging XSLT with the xslt-xpath MCP server

Find the cause with the tools before changing the stylesheet: searching the stylesheet for the output's text fails for computed
output, and adding `xsl:message` edits the user's files. For writing and checking the fix - linting, running, XSpec tests - use the
`xslt-xpath` skill.

## Tools

| Tool | Use it to |
| --- | --- |
| `output_origin` | For a line of the output, or text in it, from the user's last run in VS Code: the instruction that wrote it, its template and mode, and the input node it was written for |
| `input_rules` | For an input element (or a whole input file), from the user's last run in VS Code: the templates, `xsl:for-each` etc. and built-in rules that processed it and its attributes and text |
| `trace_configuration` | For a stylesheet: the command that runs it with logpoints (no VS Code) - the local variables, or `{XPath}` messages, at lines you choose, each time they're reached |
| `debug_status` / `debug_evaluate` | Read the user's paused XSLT debug session: where it's paused, the call stack, a frame's variables and context - and XPath evaluated there |
| `profile_configuration` | For a stylesheet: the command that runs it with Saxon's timing profile (PE/EE), and the command that summarises the profile as text, ranked by net time |

`output_origin` and `input_rules` read the user's last run in VS Code. When there's none, or the stylesheet or input has changed since,
they ask the user for the extension to run it - a notification in the user's window, unless they've said to always run it - and wait
for it (give `stylesheet` if there's been no run yet). If the user declines, doesn't answer, or has turned runs off, the tool says so:
carry on by reading the code, or with `trace_configuration`. `debug_status` reads the user's debug session. `trace_configuration` and `profile_configuration` give commands
you run yourself (the user may be asked to allow them).

## When the output is wrong

Find the code that wrote it instead of searching the stylesheet for the output's text, which fails for computed output.

1. `output_origin` with the wrong text (or its line): for each part, the instruction that wrote it, the template or function it's in -
   with its `match` and `mode` - and the input node it was written for, as an XPath for the input file.
2. It reads the output of the user's last **Run and Debug** or **Run Without Debugging** (SaxonJ) in VS Code - asking the user to run
   it, and waiting, when there's none or the stylesheet has changed since (see above).
3. Check the input node with `evaluate_xpath` (its path is an XPath for the input file), then fix the instruction. A part written by the
   wrong template often means a match pattern, a mode or a priority is wrong: `find_references` on the mode shows the other templates.
4. Only XML output (`method="xml"`) is mapped - not `html`, `xhtml`, `json` or `text`. For HTML output, ask the user before changing
   `xsl:output` to `method="xml"` for the investigation - the elements are the same, written as XML - then call `output_origin` again,
   which asks them to run it, and
   change it back afterwards. Literal text is mapped to where it is in the stylesheet, and copied nodes to the source document.
5. **Output missing, or stray text in it?** Start from the input: `input_rules` on the input file lists the elements only built-in rules
   processed - no template matched them, so with the default `text-only-copy` their text went to the output as it is - and, for an
   element (by its path), every rule that processed it, its attributes and text, in which mode. An element no rule processed wasn't
   selected by any `xsl:apply-templates` or `xsl:for-each`: look at the templates of its nearest processed ancestor, which it gives.

## Seeing values inside the stylesheet

`evaluate_xpath` has no stylesheet around it: no variables, parameters, keys or functions. To see those as the stylesheet runs, trace it
instead of adding `xsl:message` and editing the stylesheet:

1. `trace_configuration` with the top-level stylesheet (and `source`, for other input). It gives a command with `LOGPOINTS` to replace.
2. Choose lines with `find_declaration` or `list_declarations`: `--log FILE:LINE` prints the local variables there each time it's reached;
   `--log 'FILE:LINE=total {$total} for {@id}'` prints a message with XPath parts. Narrow a template that runs often with
   `--when 'FILE:LINE=CONDITION'` and `--max-hits N`.
3. Read the end of the output: a logpoint **never reached** means that template, function or branch didn't run - often the real bug.
   For a large input, trace on a smaller `source` first: a traced run is slower than a normal one, and a run your command times out
   ends before that summary is printed.
4. Values are in the debugger's notation: strings in single quotes, `true()`, nodes with their paths (`/orders/order[2]`), small maps
   and arrays in full. The same notation as the user's Variables view.

## With the user's debug session

When the user is debugging, or agrees to: ask them to set a breakpoint where you want to look and start a session (or run on to it),
then `debug_status` with `waitForPauseSeconds` waits for the pause and gives the call stack and the frame's variables and context.
`debug_evaluate` evaluates XPath there, with the stylesheet's variables, functions and keys - go into a value with XPath (`$m?key`,
`$order/line[2]`) - with Saxon-HE's functions only, unless the user has allowed Saxon-PE/EE's extension functions (or turned evaluation off). You can't step,
continue or change breakpoints: ask the user, then call `debug_status` again. Without a session, use `trace_configuration`.

## Profiling a slow stylesheet

Only when the user asks why a transformation is slow, or asks you to speed it up - don't profile unprompted. Saxon's profiler needs
**Saxon-PE or EE**: with HE, `profile_configuration` says so - tell the user and stop; don't look for another way.

1. Call `profile_configuration` with the top-level stylesheet. Give `source` - the XML to run it on - if the user means a particular
   or larger input: a small one is mostly start-up. It gives two commands: one runs the stylesheet as Quick Run does, with the profile
   written to the temporary files and several runs; the other summarises the profile as text. Run them in that order.
2. **Read the summary, not Saxon's own report.** Each line is a template, function or global variable, ranked by **net** time - the time
   in it, not in what it calls. Gross includes the templates and functions it calls, so a caller of the slow code ranks high without
   being slow itself. The first run (the Java VM's warm-up) is already left out; the times are the average of the others.
3. Go to the top lines with `find_declaration` or `find_references`, and look for the usual causes: a `//` path or a lookup that could
   use `xsl:key`, repeated per item; a large sequence built by repeated appends; a template applied many more times than the input
   needs (check the calls); a function recomputing the same value (a high count with a small net time each).
4. After a change, run the same two commands again and compare. Say what you measured before and after, and that the times are
   relative: tracing switches off some optimisations, so they don't equal the untraced run time. Keep the output the same - run the
   XSpec tests.

Saxon times templates, functions and globals, not lines inside them (`top=0` in the summary command shows all of them). The profile has
no call tree, so when a function is hot, `find_references` shows who calls it.

## What to tell the user

Say which tool showed the cause - the instruction and template `output_origin` gave, the rule `input_rules` gave, the values a trace
or the session showed, or the profile's top lines - then what you changed, and how you checked it (lint, run, XSpec tests). If you
asked the user to run or debug the stylesheet, or changed `xsl:output` for the investigation, say so - and that you changed it back.
