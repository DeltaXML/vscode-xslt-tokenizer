# XML catalog demo

An XML catalog maps the URIs used in a stylesheet - e.g. the `href` of an `xsl:import` - to the files they're resolved
to. The stylesheet can then import a library by a fixed name, such as `http://example.com/xslt/strings.xsl`, wherever
the library's files are kept: only the catalog changes when they move.

```
catalog-demo/
├── catalog.xml              master catalog: hands lookups on to catalogs/libraries.xml (nextCatalog)
├── catalogs/
│   └── libraries.xml        secondary catalog: a uri entry for each library
├── lib/
│   ├── strings/strings.xsl  imported as http://example.com/xslt/strings.xsl
│   └── dates/dates.xsl      imported as http://example.com/xslt/dates.xsl
├── main.xsl                 top-level stylesheet: imports both libraries by their catalog names
└── .vscode/settings.json    "XSLT.resources.catalog": "catalog.xml"
```

How `http://example.com/xslt/strings.xsl` is resolved:

1. `catalog.xml` has no entry for it, so its `nextCatalog` entry is tried: `catalogs/libraries.xml`.
2. `libraries.xml` has a `uri` entry with that `name`, whose `uri` is `../lib/strings/strings.xsl` - relative to
   `libraries.xml`.
3. So the import is `lib/strings/strings.xsl`.

## Try it

1. Open this `catalog-demo` folder in VS Code (**File > Open Folder...**), so that its `.vscode/settings.json` applies.
   (In a larger workspace, set `XSLT.resources.catalog` to the catalog's path relative to the workspace folder
   instead, e.g. `sample/catalog-demo/catalog.xml`.)
2. Open `main.xsl`: there are no problems, and hovering on `str:shout` shows the function's signature, from
   `strings.xsl`.
3. Cmd/Ctrl+click an `href`: the library file opens.
4. Run it with **Quick Run**: the task passes `-catalog:<path>/catalog.xml` to Saxon, and the result is e.g.
   `CATALOGS WORK! | Wednesday 30 September 2026`.

Things to try:

- Remove the setting: the imports aren't resolved, so `str:shout`, `dt:long-date` and `$str:separator` are reported -
  and Saxon fails with an I/O error for `http://example.com/xslt/strings.xsl`.
- Move `lib/dates` to another folder, and update the `uri` in `catalogs/libraries.xml`: `main.xsl` doesn't change.
- Replace the two `uri` entries with the `rewriteURI` entry in the comment in `libraries.xml`, and change the hrefs in
  `main.xsl` to `http://example.com/lib/strings/strings.xsl` and `http://example.com/lib/dates/dates.xsl`.

From the command line, with Saxon:

```
java -cp saxon-he-13.0.jar net.sf.saxon.Transform -xsl:main.xsl -it -catalog:catalog.xml
```
