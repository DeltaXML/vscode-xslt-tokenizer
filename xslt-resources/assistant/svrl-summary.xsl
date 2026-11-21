<?xml version="1.0" encoding="UTF-8"?>
<!--
  A Schematron validation's SVRL report as plain text, for an AI assistant to read: the numbers of failed assertions and
  successful reports, then each, in the report's order - its role, where it is, the message and the test that gave it. A
  location is an XPath for the validated document: evaluate it with the evaluate_xpath tool for its line and column.
  A validation exits with 0 even when assertions fail, so its exit code says nothing about them.
  Run with the Saxon jar: java -cp saxon.jar net.sf.saxon.Transform -s:report.svrl -xsl:svrl-summary.xsl
-->
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:svrl="http://purl.oclc.org/dsdl/svrl" exclude-result-prefixes="#all">

  <xsl:output method="text"/>

  <xsl:template match="/">
    <xsl:variable name="problems" as="element()*" select="//(svrl:failed-assert | svrl:successful-report)"/>
    <xsl:value-of select="'Schematron: ' || count($problems[self::svrl:failed-assert]) || ' failed assertions, ' || count($problems[self::svrl:successful-report]) || ' successful reports - ' || count(//svrl:fired-rule) || ' rules fired&#10;'"/>
    <xsl:for-each select="$problems">
      <xsl:value-of select="(if (self::svrl:failed-assert) then 'assert ' else 'report ') || '[' || (@role, 'error')[1] || '] ' || @location || '&#10;'"/>
      <xsl:value-of select="'  ' || normalize-space(svrl:text) || '&#10;'"/>
      <xsl:value-of select="'  test: ' || normalize-space(@test) || (if (@id) then '   id: ' || @id else '') || '&#10;'"/>
    </xsl:for-each>
  </xsl:template>
</xsl:stylesheet>
