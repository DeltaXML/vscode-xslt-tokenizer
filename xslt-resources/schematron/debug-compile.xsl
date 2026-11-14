<?xml version="1.0" encoding="UTF-8"?>
<!--
  Debugging a Schematron schema (see src/schematronDebug.ts): the schema compiled by SchXslt2's transpiler to the XSLT
  stylesheet the debugger runs - as for validation (see validate.xsl), with the files sch:include brings in included,
  and text value templates rewritten when they're allowed. Each rule has an id - its own, else as validate.xsl gives it,
  vscode-rule- and its number in the schema file, or for a file sch:include brings in, vscode-irule- and its number in
  the schema with its files included - and each assertion and report without one vscode-assert- and its number there:
  SchXslt2 copies them into its stylesheet, with the elements that report them, so its lines can be matched with the
  schema's (see src/schematronSourceMap.ts). The modules of xsl:include and xsl:import - and xsl:import-schema's schema -
  are by their absolute URIs, as the stylesheet isn't in the schema's folder.
-->
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:sch="http://purl.oclc.org/dsdl/schematron" xmlns:tvt="urn:x-vscode-xslt-xpath:schematron-expand-text"
  xmlns:xd="urn:x-vscode-xslt-xpath:schematron-debug" exclude-result-prefixes="#all">

  <xsl:import href="validate.xsl"/>

  <xsl:template match="/">
    <!-- the schema's rules, patterns and groups with ids as validate.xsl gives them, so the report is matched with the
         schema's rules as a validation's is - then the files sch:include brings in included, and their rules' ids -->
    <xsl:variable name="schemaIds" as="document-node()">
      <xsl:document>
        <xsl:for-each select="doc($schema)/*">
          <xsl:copy>
            <xsl:attribute name="xml:base" select="$schema"/>
            <xsl:apply-templates select="@* except @xml:base, node()" mode="annotate"/>
          </xsl:copy>
        </xsl:for-each>
      </xsl:document>
    </xsl:variable>
    <xsl:variable name="included" as="document-node()">
      <xsl:document>
        <xsl:apply-templates select="$schemaIds/*" mode="xd:include"/>
      </xsl:document>
    </xsl:variable>
    <xsl:variable name="annotated" as="document-node()">
      <xsl:document>
        <xsl:apply-templates select="$included/*" mode="xd:annotate"/>
      </xsl:document>
    </xsl:variable>
    <xsl:variable name="standard" as="document-node()">
      <xsl:choose>
        <xsl:when test="$allow-expand-text">
          <xsl:document>
            <xsl:apply-templates select="$annotated/*" mode="tvt:expand"/>
          </xsl:document>
        </xsl:when>
        <xsl:otherwise>
          <xsl:sequence select="$annotated"/>
        </xsl:otherwise>
      </xsl:choose>
    </xsl:variable>
    <xsl:sequence select="transform(map {
        'stylesheet-location': $transpiler,
        'source-node': $standard,
        'stylesheet-params': map { QName('http://dmaus.name/ns/2023/schxslt', 'phase'): $phase }
      })?output"/>
  </xsl:template>

  <!-- the files sch:include brings in, included - with the base URIs of their files - and the modules of xsl:include and
       xsl:import, and xsl:import-schema's schema, by their absolute URIs -->
  <xsl:mode name="xd:include" on-no-match="shallow-copy"/>

  <xsl:template match="/*" mode="xd:include">
    <xsl:copy>
      <xsl:attribute name="xml:base" select="base-uri(.)"/>
      <xsl:apply-templates select="@* except @xml:base, node()" mode="#current"/>
    </xsl:copy>
  </xsl:template>

  <xsl:template match="sch:include[@href]" mode="xd:include">
    <xsl:apply-templates select="doc(resolve-uri(@href, base-uri(.)))/*" mode="#current"/>
  </xsl:template>

  <xsl:template match="xsl:include/@href | xsl:import/@href | xsl:import-schema/@schema-location" mode="xd:include">
    <xsl:attribute name="{name()}" select="resolve-uri(., base-uri(..))"/>
  </xsl:template>

  <!-- each rule's id, and each assertion's and report's -->
  <xsl:mode name="xd:annotate" on-no-match="shallow-copy"/>

  <xsl:template match="sch:rule[not(@id)]" mode="xd:annotate">
    <xsl:copy>
      <xsl:attribute name="id" select="'vscode-irule-' || count(preceding::sch:rule) + 1"/>
      <xsl:apply-templates select="@*, node()" mode="#current"/>
    </xsl:copy>
  </xsl:template>

  <xsl:template match="sch:assert[not(@id)] | sch:report[not(@id)]" mode="xd:annotate">
    <xsl:copy>
      <xsl:attribute name="id" select="'vscode-assert-' || count(preceding::sch:assert | preceding::sch:report) + 1"/>
      <xsl:apply-templates select="@*, node()" mode="#current"/>
    </xsl:copy>
  </xsl:template>

</xsl:stylesheet>
