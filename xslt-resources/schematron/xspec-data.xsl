<?xml version="1.0" encoding="UTF-8"?>
<!--
  XSpec tests generated from a Schematron schema (see src/schematronTests.ts): the schema's results for XML documents -
  the schema's XML context file, to choose the data from, and the fragments of it chosen - with one run of Saxon, the
  schema compiled once by SchXslt2's transpiler.

  The source document lists the documents: <documents><document href="file:/..."/><fragment>...</fragment></documents>
  - a document by its URI, a fragment as its content. The result is an SVRL report for each, in order:
  <results><result>svrl:schematron-output</result>...</results>.

  The schema is the one validate.xsl validates with - its files sch:include brings in included, each rule with an id (as
  validate.xsl gives one) - and with a report in each rule that isn't abstract that's always reported, with the id
  vscode-fired: and the rule's id: the nodes each rule fires for, which SVRL doesn't otherwise locate.
-->
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:sch="http://purl.oclc.org/dsdl/schematron" xmlns:tvt="urn:x-vscode-xslt-xpath:schematron-expand-text"
  xmlns:xd="urn:x-vscode-xslt-xpath:schematron-xspec-data" exclude-result-prefixes="#all">

  <xsl:import href="validate.xsl"/>

  <xsl:template match="/">
    <!-- the schema, with the files sch:include brings in included - then each rule's id, and its report -->
    <xsl:variable name="included" as="document-node()">
      <xsl:document>
        <xsl:apply-templates select="doc($schema)/*" mode="xd:include"/>
      </xsl:document>
    </xsl:variable>
    <xsl:variable name="annotated" as="document-node()">
      <xsl:document>
        <xsl:for-each select="$included/*">
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
    <results>
      <xsl:for-each select="/*/*">
        <xsl:variable name="source" as="document-node()">
          <xsl:choose>
            <xsl:when test="self::document">
              <xsl:sequence select="doc(@href)"/>
            </xsl:when>
            <xsl:otherwise>
              <xsl:document>
                <xsl:copy-of select="*"/>
              </xsl:document>
            </xsl:otherwise>
          </xsl:choose>
        </xsl:variable>
        <result>
          <xsl:sequence select="transform(map {
              'stylesheet-node': $compiled,
              'stylesheet-base-uri': $schema,
              'source-node': $source
            })?output"/>
        </result>
      </xsl:for-each>
    </results>
  </xsl:template>

  <!-- the files sch:include brings in, included - with the base URIs of their files -->
  <xsl:mode name="xd:include" on-no-match="shallow-copy"/>

  <xsl:template match="sch:include[@href]" mode="xd:include">
    <xsl:for-each select="doc(resolve-uri(@href, base-uri(.)))/*">
      <xsl:copy>
        <xsl:attribute name="xml:base" select="base-uri(.)"/>
        <xsl:apply-templates select="@* except @xml:base, node()" mode="#current"/>
      </xsl:copy>
    </xsl:for-each>
  </xsl:template>

  <!-- a rule that isn't abstract: its id, as validate.xsl gives one, and the report always reported for it -->
  <xsl:template match="sch:rule[not(@abstract = 'true')]" mode="annotate" priority="1">
    <xsl:variable name="id" select="(@id, 'vscode-rule-' || count(preceding::sch:rule) + 1)[1]"/>
    <xsl:copy>
      <xsl:attribute name="id" select="$id"/>
      <xsl:apply-templates select="@* except @id, node()" mode="#current"/>
      <sch:report test="true()" id="vscode-fired:{$id}"/>
    </xsl:copy>
  </xsl:template>

</xsl:stylesheet>
