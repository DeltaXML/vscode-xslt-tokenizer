<?xml version="1.0" encoding="UTF-8"?>
<!--
  Schematron: Validate - the source document validated with a Schematron schema, as SchXslt2 - the Schematron
  processor bundled with XSpec - validates it, with one run of Saxon: the schema compiled to an XSLT 3.0 stylesheet by
  SchXslt2's transpiler, which is then run on the source document. The result is SchXslt2's SVRL report.
  The string parameters must be passed to Saxon as XPath expressions - ?schema="'file:/...'" - not as text: with an
  xs:untypedAtomic value, Saxon 13 fails with an internal error (a NullPointerException) for transform()'s
  'stylesheet-params' (https://saxonica.plan.io/issues/7323 - Saxon 12.9 doesn't).
-->
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:sch="http://purl.oclc.org/dsdl/schematron" xmlns:tvt="urn:x-vscode-xslt-xpath:schematron-expand-text" exclude-result-prefixes="#all">

  <!-- text value templates in messages, with xsl:expand-text: the non-standard extension, as standard Schematron -->
  <xsl:import href="expand-text.xsl"/>

  <!-- the schema's URI, and SchXslt2's transpile.xsl's -->
  <xsl:param name="schema" as="xs:string" required="yes"/>
  <xsl:param name="transpiler" as="xs:string" required="yes"/>
  <!-- the phase: a phase's id, or #ALL for every pattern - or #DEFAULT, the schema's defaultPhase, else #ALL -->
  <xsl:param name="phase" as="xs:string" select="'#DEFAULT'"/>
  <!-- whether text value templates are allowed in messages, with xsl:expand-text: the XSLT.schematron.allowExpandText
       setting -->
  <xsl:param name="allow-expand-text" as="xs:boolean" select="false()"/>

  <xsl:template match="/">
    <!-- each rule, pattern and group with an id, for the report's fired, suppressed and failed rules to be matched with
         them: one it doesn't have is vscode- and its name and number in the schema, e.g. vscode-rule-3 - and with the
         schema's URI as its base URI, for the files sch:include brings in -->
    <xsl:variable name="annotated" as="document-node()">
      <xsl:document>
        <xsl:for-each select="doc($schema)/*">
          <xsl:copy>
            <xsl:attribute name="xml:base" select="$schema"/>
            <xsl:apply-templates select="@* except @xml:base, node()" mode="annotate"/>
          </xsl:copy>
        </xsl:for-each>
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
    <xsl:variable name="compiled" as="document-node()" select="transform(map {
        'stylesheet-location': $transpiler,
        'source-node': $standard,
        'stylesheet-params': map { QName('http://dmaus.name/ns/2023/schxslt', 'phase'): $phase }
      })?output"/>
    <!-- with the schema's URI as its base URI, for the modules its xsl:include and xsl:import bring in - the compiled
         stylesheet's own is that of the transpiler -->
    <xsl:sequence select="transform(map {
        'stylesheet-node': $compiled,
        'stylesheet-base-uri': $schema,
        'source-node': .
      })?output"/>
  </xsl:template>

  <xsl:mode name="annotate" on-no-match="shallow-copy"/>

  <xsl:template match="sch:rule[not(@id)] | sch:pattern[not(@id)] | sch:group[not(@id)]" mode="annotate">
    <xsl:copy>
      <xsl:attribute name="id" select="'vscode-' || local-name() || '-' || count(preceding::*[node-name() = node-name(current())]) + 1"/>
      <xsl:apply-templates select="@*, node()" mode="#current"/>
    </xsl:copy>
  </xsl:template>

</xsl:stylesheet>
