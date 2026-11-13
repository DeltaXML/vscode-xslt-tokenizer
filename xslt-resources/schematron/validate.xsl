<?xml version="1.0" encoding="UTF-8"?>
<!--
  Validate with Schematron: the source document validated with a Schematron schema, as SchXslt2 - the Schematron
  processor bundled with XSpec - validates it, with one run of Saxon: the schema compiled to an XSLT 3.0 stylesheet by
  SchXslt2's transpiler, which is then run on the source document. The result is SchXslt2's SVRL report.
  The phase: SchXslt2's phase parameter isn't passed, as Saxon 13 fails with an internal error (a NullPointerException)
  for transform()'s 'stylesheet-params' with a 'stylesheet-location' known only at run time, as $transpiler is
  (https://saxonica.plan.io/issues/7323 - Saxon 12.9 doesn't) - it's the defaultPhase of the annotated copy of the
  schema instead.
  Text value templates in messages: SchXslt2's schxslt:expand-text parameter, set - as stylesheet-params can't be - by a
  stylesheet that imports the transpiler and declares the parameter again, as XSpec's Schematron wrapper does.
-->
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:sch="http://purl.oclc.org/dsdl/schematron" xmlns:map="http://www.w3.org/2005/xpath-functions/map" exclude-result-prefixes="#all">

  <!-- the schema's URI, and SchXslt2's transpile.xsl's -->
  <xsl:param name="schema" as="xs:string" required="yes"/>
  <xsl:param name="transpiler" as="xs:string" required="yes"/>
  <!-- the phase: a phase's id, or #ALL for every pattern - or #DEFAULT, the schema's defaultPhase, else #ALL -->
  <xsl:param name="phase" as="xs:string" select="'#DEFAULT'"/>
  <!-- whether text value templates are enabled in the schema's messages: the XSLT.schematron.expandText setting -->
  <xsl:param name="expand-text" as="xs:boolean" select="false()"/>

  <xsl:template match="/">
    <!-- each rule, pattern and group with an id, for the report's fired, suppressed and failed rules to be matched with
         them: one it doesn't have is vscode- and its name and number in the schema, e.g. vscode-rule-3 - and with the
         schema's URI as its base URI, for the files sch:include brings in -->
    <xsl:variable name="annotated" as="document-node()">
      <xsl:document>
        <xsl:for-each select="doc($schema)/*">
          <xsl:copy>
            <xsl:attribute name="xml:base" select="$schema"/>
            <xsl:apply-templates select="@* except (@xml:base, @defaultPhase[$phase ne '#DEFAULT'])" mode="annotate"/>
            <xsl:if test="$phase ne '#DEFAULT'">
              <xsl:attribute name="defaultPhase" select="$phase"/>
            </xsl:if>
            <xsl:apply-templates select="node()" mode="annotate"/>
          </xsl:copy>
        </xsl:for-each>
      </xsl:document>
    </xsl:variable>
    <xsl:variable name="compiled" as="document-node()" select="transform(map:merge((
        map { 'source-node': $annotated },
        if ($expand-text) then map { 'stylesheet-node': $expanding-transpiler } else map { 'stylesheet-location': $transpiler }
      )))?output"/>
    <!-- with the schema's URI as its base URI, for the modules its xsl:include and xsl:import bring in - the compiled
         stylesheet's own is that of the transpiler -->
    <xsl:sequence select="transform(map {
        'stylesheet-node': $compiled,
        'stylesheet-base-uri': $schema,
        'source-node': .
      })?output"/>
  </xsl:template>

  <!-- the transpiler, with its parameter schxslt:expand-text true -->
  <xsl:variable name="expanding-transpiler" as="document-node()">
    <xsl:document>
      <xsl:element name="xsl:stylesheet" namespace="http://www.w3.org/1999/XSL/Transform">
        <xsl:namespace name="xs" select="'http://www.w3.org/2001/XMLSchema'"/>
        <xsl:namespace name="schxslt" select="'http://dmaus.name/ns/2023/schxslt'"/>
        <xsl:attribute name="version" select="'3.0'"/>
        <xsl:element name="xsl:import" namespace="http://www.w3.org/1999/XSL/Transform">
          <xsl:attribute name="href" select="$transpiler"/>
        </xsl:element>
        <xsl:element name="xsl:param" namespace="http://www.w3.org/1999/XSL/Transform">
          <xsl:attribute name="name" select="'schxslt:expand-text'"/>
          <xsl:attribute name="as" select="'xs:boolean'"/>
          <xsl:attribute name="select" select="'true()'"/>
        </xsl:element>
      </xsl:element>
    </xsl:document>
  </xsl:variable>

  <xsl:mode name="annotate" on-no-match="shallow-copy"/>

  <xsl:template match="sch:rule[not(@id)] | sch:pattern[not(@id)] | sch:group[not(@id)]" mode="annotate">
    <xsl:copy>
      <xsl:attribute name="id" select="'vscode-' || local-name() || '-' || count(preceding::*[node-name() = node-name(current())]) + 1"/>
      <xsl:apply-templates select="@*, node()" mode="#current"/>
    </xsl:copy>
  </xsl:template>

</xsl:stylesheet>
