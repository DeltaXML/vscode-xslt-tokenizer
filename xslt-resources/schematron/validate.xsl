<?xml version="1.0" encoding="UTF-8"?>
<!--
  Validate with Schematron: the source document validated with a Schematron schema, as SchXslt2 - the Schematron
  processor bundled with XSpec - validates it, with one run of Saxon: the schema compiled to an XSLT 3.0 stylesheet by
  SchXslt2's transpiler, which is then run on the source document. The result is SchXslt2's SVRL report.
  With the schema's default phase: SchXslt2's phase parameter isn't passed, as Saxon 13.1 fails with an internal error
  (a NullPointerException) for transform()'s 'stylesheet-params' - another phase could be set as the defaultPhase of the
  annotated copy of the schema instead.
-->
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:sch="http://purl.oclc.org/dsdl/schematron" exclude-result-prefixes="#all">

  <!-- the schema's URI, and SchXslt2's transpile.xsl's -->
  <xsl:param name="schema" as="xs:string" required="yes"/>
  <xsl:param name="transpiler" as="xs:string" required="yes"/>

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
    <xsl:variable name="compiled" as="document-node()" select="transform(map {
        'stylesheet-location': $transpiler,
        'source-node': $annotated
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
