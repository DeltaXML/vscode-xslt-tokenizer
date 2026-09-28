# xdoc-md Invisible XML grammar

[xdoc-md.ixml](xdoc-md.ixml) is an [Invisible XML](https://invisiblexml.org) grammar for the documentation notes that the
extension supports in XSLT 4.0 stylesheets: an `xsl:note` with `format="xdoc-md"`, containing a Markdown description,
then `@param`, `@return`, `@see`, `@since`, `@deprecated` and `@error` fields.

With it, a stylesheet can turn its notes into XML - for example, to generate documentation for a library of functions.
The XPath 4.0 `invisible-xml()` function, supported by Saxon-PE and Saxon-EE 13, compiles the grammar to a parser
function. The input is the note's string value, so CDATA sections and entity references are already decoded, with a
line break appended:

```xml
<xsl:variable name="parser" select="invisible-xml(unparsed-text('xdoc-md.ixml'))"/>
<xsl:for-each select="doc($stylesheet-uri)//xsl:note[@format = 'xdoc-md']">
  <xsl:sequence select="$parser(string(.) || '&#10;')"/>
</xsl:for-each>
```

For this note:

```xml
<xsl:note format="xdoc-md">
  Returns the area of a rectangle, **scaled** by an optional factor.

  @param $width the width, in `cm`
  @param $height the height
    continued on a second line
  @return the area
</xsl:note>
```

the result is:

```xml
<note>
  <description>
    <line>Returns the area of a rectangle, **scaled** by an optional factor.</line>
  </description>
  <param name="width">the width, in `cm`</param>
  <param name="height">the height<line>continued on a second line</line></param>
  <return>the area</return>
</note>
```

Notes:

- Markdown within the text, such as `**bold**` or `` `code` ``, is kept as text.
- A line in the description that starts with `@` followed by a name other than one of the fields, e.g. `@class`, isn't
  parsed: the result is an `ixml:state="failed"` element giving its line and column. The extension itself treats
  such a line as text.
- The grammar was tested with Saxon-PE 13. Running Saxon from the command line with XPath 4.0 needs
  `--allowSyntaxExtensions:on`.
