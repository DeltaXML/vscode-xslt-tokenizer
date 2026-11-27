# XSpec 4.1.2

The `src` folder and `LICENSE` of [XSpec](https://github.com/xspec/xspec) v4.1.2 (released 2026-09-22), unchanged - used by
the extension to compile, run and report XSpec tests (see src/xspecRunner.ts). XSpec is MIT licensed (see LICENSE).

`lib/schxslt2` is [SchXslt2](https://codeberg.org/SchXslt/schxslt2) 1.11.3, unchanged, from its release zip - newer
than the 1.11.2 XSpec 4.1.2 has in its `lib` (see `lib/README.md`). It's the Schematron to XSLT 3.0 transpiler, used to
validate XML with Schematron and to run and debug Schematron schemas and their XSpec tests. SchXslt2 is MIT licensed
(see `lib/schxslt2/LICENSE`). Keep it at 1.11.3 or later: in 1.11.2, with three or more rules of a pattern matching
the same node, the third and later rules fire after a suppressed one, giving false reports
([issue #59](https://codeberg.org/SchXslt/schxslt2/issues/59)).

To update: replace `src`, `lib/schxslt2` and `LICENSE` with those of a newer release - keeping SchXslt2 at 1.11.3 or
later - regenerate src/xspecSchema.ts from its `src/schemas/xspec.rnc` (see resources/xslt/xsd-to-schemadata.xsl), and
update the versions in ThirdPartyNotices.txt.
