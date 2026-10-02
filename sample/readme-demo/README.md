# README screenshot demo

A small XSLT 4.0 stylesheet for the first screenshot in the extension's README: a function documented with an
`xsl:note`, the hover help for a call of it, and the **XSLT Imports** view.

- `area-demo.xsl` - the stylesheet: `ex:area`, with its note, and a call of it with a keyword argument
- `lib/geometry.xsl` - imported, with `ex:perimeter` (the note's `@see`), which imports `lib/units.xsl`
- `lib/colours.xsl` - included, with `ex:colour`

It runs with Saxon PE/EE 13, e.g. with Quick Run (no XML context file is needed): the result is
`<shape colour="#d33" perimeter="54"><area>55</area></shape>`.

## Taking the screenshot

1. Open this folder in VS Code, and open `area-demo.xsl` - close any other editors.
2. In the Explorer, collapse everything except the **XSLT Imports** view, and expand its tree.
3. Hide the minimap (**View: Toggle Minimap**), and size the window so that the whole stylesheet is visible.
4. Hover over `ex:area` in `ex:area($width, $height, scale := 0.5)`, near the end. The hover is shown above the
   call, so it covers the template, not the note.
5. Check that the status bar shows no problems, then take the screenshot.
