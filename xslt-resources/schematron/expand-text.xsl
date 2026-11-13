<?xml version="1.0" encoding="UTF-8"?>
<!--
  expand-text.xsl: a Schematron schema that uses text value templates - a non-standard extension - as standard ISO
  Schematron, for any Schematron processor.

  With xsl:expand-text="yes" on a Schematron element - as on an element of an XSLT stylesheet - the text of the messages
  within it may have text value templates: e.g.
      <assert test="@date castable as xs:date" xsl:expand-text="yes">Order {@id} has an invalid date: {@date}</assert>
  is
      <assert test="@date castable as xs:date">Order <value-of select="@id"/> has an invalid date: <value-of select="@date"/></assert>
  - each {expression} a sch:value-of, and {{ and }} the braces as text. It's inherited, as in XSLT: on the schema, it's
  for every message; xsl:expand-text="no" on an element within turns it off there. The messages are the text of
  sch:assert, sch:report, sch:diagnostic and sch:property - and of sch:emph, sch:span and sch:dir within them: where
  sch:value-of is allowed.

  The files sch:include brings in are included - each with its own xsl:expand-text, so a file without it is unchanged,
  braces and all - with xml:base, for the files they refer to. The xsl:expand-text attributes are removed.

  It's the first step of 'Validate with Schematron', and of XSpec tests of a schema, in the XSLT/XPath for VS Code
  extension, with its setting XSLT.schematron.allowExpandText - and can be run before SchXslt2, or another processor:
      java -jar saxon.jar -s:schema.sch -xsl:expand-text.xsl -o:schema-standard.sch
-->
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:sch="http://purl.oclc.org/dsdl/schematron" xmlns:tvt="urn:x-vscode-xslt-xpath:schematron-expand-text"
  exclude-result-prefixes="#all">

  <xsl:mode on-no-match="shallow-copy"/>
  <xsl:mode name="tvt:expand" on-no-match="shallow-copy"/>

  <!-- run on its own, e.g. on the command line: written to a file, with -o:, its references to other files are relative
       to it. Otherwise - e.g. applied in the mode tvt:expand by another stylesheet - they're absolute -->
  <xsl:template match="/">
    <xsl:apply-templates mode="tvt:expand">
      <xsl:with-param name="output" select="current-output-uri()[starts-with(., 'file:')]" tunnel="yes"/>
    </xsl:apply-templates>
  </xsl:template>

  <!-- the root: with its base URI, for the files it refers to - as is an included file's. Written to a file, e.g. with -o:
       on the command line, relative to it - and only where its folder isn't the file's own -->
  <xsl:template match="/*" mode="tvt:expand">
    <xsl:param name="output" as="xs:anyURI?" tunnel="yes"/>
    <xsl:copy>
      <xsl:choose>
        <xsl:when test="empty($output)">
          <xsl:attribute name="xml:base" select="base-uri(.)"/>
        </xsl:when>
        <xsl:when test="tvt:folder(base-uri(.)) ne tvt:folder($output)">
          <xsl:attribute name="xml:base" select="tvt:relative(base-uri(.), $output)"/>
        </xsl:when>
      </xsl:choose>
      <xsl:apply-templates select="@* except @xml:base, node()" mode="#current"/>
    </xsl:copy>
  </xsl:template>

  <!-- the modules of xsl:include and xsl:import, and xsl:import-schema's schema: from where they're written - as SchXslt2
       copies them into its stylesheet, whose base URI is the schema's, not the xml:base of an included file. Written to a
       file, relative to it - else, absolute -->
  <xsl:template match="xsl:include/@href | xsl:import/@href | xsl:import-schema/@schema-location" mode="tvt:expand">
    <xsl:param name="output" as="xs:anyURI?" tunnel="yes"/>
    <xsl:variable name="uri" select="string(resolve-uri(., base-uri(..)))"/>
    <xsl:attribute name="{name()}" select="if (exists($output)) then tvt:relative($uri, $output) else $uri"/>
  </xsl:template>

  <xsl:function name="tvt:folder" as="xs:string">
    <xsl:param name="uri" as="xs:string"/>
    <xsl:sequence select="replace($uri, '/[^/]*$', '/')"/>
  </xsl:function>

  <!-- a file: URI relative to another, e.g. ../shared/library.sch -->
  <xsl:function name="tvt:relative" as="xs:string">
    <xsl:param name="uri" as="xs:string"/>
    <xsl:param name="from" as="xs:string"/>
    <xsl:variable name="path" select="tokenize(replace($uri, '^file:/*', ''), '/')"/>
    <xsl:variable name="fromFolder" select="tokenize(replace(tvt:folder($from), '^file:/*', ''), '/')[.]"/>
    <xsl:variable name="common" select="(for $i in 1 to count($fromFolder) return $i[$path[$i] eq $fromFolder[$i]][every $j in 1 to $i satisfies $path[$j] eq $fromFolder[$j]])[last()]"/>
    <xsl:variable name="shared" select="($common, 0)[1]"/>
    <xsl:sequence select="if ($shared eq 0) then $uri else
      string-join((for $i in $shared + 1 to count($fromFolder) return '..', subsequence($path, $shared + 1)), '/')"/>
  </xsl:function>

  <xsl:template match="@xsl:expand-text" mode="tvt:expand"/>

  <!-- sch:include: the element of the file it refers to, as ISO Schematron includes it -->
  <xsl:template match="sch:include[@href]" mode="tvt:expand">
    <xsl:apply-templates select="doc(resolve-uri(@href, base-uri(.)))/*" mode="#current"/>
  </xsl:template>

  <!-- the text of a message, where text value templates are enabled -->
  <xsl:template match="text()[tvt:is-message(..)][tvt:expand-text(..)]" mode="tvt:expand">
    <xsl:variable name="prefix" select="prefix-from-QName(node-name(..))"/>
    <xsl:variable name="parts" select="tvt:parts(string(.))"/>
    <xsl:for-each select="$parts">
      <xsl:choose>
        <xsl:when test="?expression">
          <xsl:sequence select="tvt:value-of($prefix, ?expression)"/>
        </xsl:when>
        <xsl:when test="normalize-space(?text) = '' and exists($parts?expression)">
          <!-- whitespace, e.g. between {$a} {$b}: as an expression, as the validation stylesheet - XSLT - would strip
               it as text, whereas in a text value template it's kept -->
          <xsl:sequence select="tvt:value-of($prefix, '''' || ?text || '''')"/>
        </xsl:when>
        <xsl:otherwise>
          <xsl:value-of select="?text"/>
        </xsl:otherwise>
      </xsl:choose>
    </xsl:for-each>
  </xsl:template>

  <xsl:function name="tvt:value-of" as="element()">
    <xsl:param name="prefix" as="xs:string?"/>
    <xsl:param name="select" as="xs:string"/>
    <xsl:element name="{if ($prefix) then $prefix || ':' else ''}value-of" namespace="http://purl.oclc.org/dsdl/schematron">
      <xsl:attribute name="select" select="$select"/>
    </xsl:element>
  </xsl:function>

  <!-- an element whose text is a message: where sch:value-of is allowed -->
  <xsl:function name="tvt:is-message" as="xs:boolean">
    <xsl:param name="element" as="element()"/>
    <xsl:sequence select="exists($element/(self::sch:assert | self::sch:report | self::sch:diagnostic | self::sch:property))
      or exists($element/(self::sch:emph | self::sch:span | self::sch:dir)[ancestor::sch:assert or ancestor::sch:report or ancestor::sch:diagnostic or ancestor::sch:property])"/>
  </xsl:function>

  <!-- whether text value templates are enabled: the nearest xsl:expand-text, in the element's file -->
  <xsl:function name="tvt:expand-text" as="xs:boolean">
    <xsl:param name="element" as="element()"/>
    <xsl:sequence select="($element/ancestor-or-self::*/@xsl:expand-text)[last()]/normalize-space() = ('yes', 'true', '1')"/>
  </xsl:function>

  <!-- the text, as its parts: each a map with the text, or an expression - from a { to the matching }, not one in a string
       literal, or of a nested { } in the expression, e.g. a map constructor -->
  <xsl:function name="tvt:parts" as="map(xs:string, xs:string)*">
    <xsl:param name="text" as="xs:string"/>
    <xsl:variable name="chars" select="string-to-codepoints($text) ! codepoints-to-string(.)"/>
    <xsl:iterate select="1 to count($chars)">
      <xsl:param name="text" as="xs:string" select="''"/>
      <xsl:param name="expression" as="xs:string?" select="()"/>
      <xsl:param name="depth" as="xs:integer" select="0"/>
      <xsl:param name="quote" as="xs:string?" select="()"/>
      <xsl:param name="skip" as="xs:boolean" select="false()"/>
      <xsl:on-completion>
        <!-- an unfinished expression is text, as written -->
        <xsl:variable name="rest" select="$text || (if (exists($expression)) then '{' || $expression else '')"/>
        <xsl:sequence select="map { 'text': $rest }[$rest]"/>
      </xsl:on-completion>
      <xsl:variable name="c" select="$chars[current()]"/>
      <xsl:variable name="next" select="$chars[current() + 1]"/>
      <xsl:choose>
        <xsl:when test="$skip">
          <xsl:next-iteration>
            <xsl:with-param name="skip" select="false()"/>
          </xsl:next-iteration>
        </xsl:when>
        <xsl:when test="empty($expression)">
          <xsl:choose>
            <xsl:when test="$c = ('{', '}') and $next = $c">
              <xsl:next-iteration>
                <xsl:with-param name="text" select="$text || $c"/>
                <xsl:with-param name="skip" select="true()"/>
              </xsl:next-iteration>
            </xsl:when>
            <xsl:when test="$c = '{'">
              <xsl:sequence select="map { 'text': $text }[$text]"/>
              <xsl:next-iteration>
                <xsl:with-param name="text" select="''"/>
                <xsl:with-param name="expression" select="''"/>
                <xsl:with-param name="depth" select="1"/>
              </xsl:next-iteration>
            </xsl:when>
            <xsl:otherwise>
              <xsl:next-iteration>
                <xsl:with-param name="text" select="$text || $c"/>
              </xsl:next-iteration>
            </xsl:otherwise>
          </xsl:choose>
        </xsl:when>
        <xsl:when test="exists($quote)">
          <xsl:next-iteration>
            <xsl:with-param name="expression" select="$expression || $c"/>
            <xsl:with-param name="quote" select="if ($c = $quote) then () else $quote"/>
          </xsl:next-iteration>
        </xsl:when>
        <xsl:when test="$c = ('''', '&quot;')">
          <xsl:next-iteration>
            <xsl:with-param name="expression" select="$expression || $c"/>
            <xsl:with-param name="quote" select="$c"/>
          </xsl:next-iteration>
        </xsl:when>
        <xsl:when test="$c = '}' and $depth = 1">
          <xsl:sequence select="map { 'expression': $expression }[normalize-space($expression)]"/>
          <xsl:next-iteration>
            <xsl:with-param name="expression" select="()"/>
            <xsl:with-param name="depth" select="0"/>
          </xsl:next-iteration>
        </xsl:when>
        <xsl:otherwise>
          <xsl:next-iteration>
            <xsl:with-param name="expression" select="$expression || $c"/>
            <xsl:with-param name="depth" select="$depth + (if ($c = '{') then 1 else if ($c = '}') then -1 else 0)"/>
          </xsl:next-iteration>
        </xsl:otherwise>
      </xsl:choose>
    </xsl:iterate>
  </xsl:function>

</xsl:stylesheet>
