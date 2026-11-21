<?xml version="1.0" encoding="UTF-8"?>
<!--
  An XSpec result (the file XSpec's test runner writes) as plain text, for an AI assistant to read: the numbers passed, failed
  and pending, then each failure - its scenarios and the expectation, with what was expected and what the test gave - and
  each pending test. An XSpec run exits with 0 even when tests fail, so its exit code says nothing about them.
  Run with the Saxon jar: java -cp saxon.jar net.sf.saxon.Transform -s:X-result.xml -xsl:xspec-summary.xsl
-->
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:x="http://www.jenitennison.com/xslt/xspec" exclude-result-prefixes="#all">

  <xsl:output method="text"/>
  <!-- the most characters of an expected or actual value shown -->
  <xsl:param name="limit" as="xs:integer" select="400"/>

  <xsl:function name="x:short" as="xs:string">
    <xsl:param name="nodes" as="node()*"/>
    <xsl:variable name="text" as="xs:string" select="normalize-space(string-join($nodes ! string(.), ' '))"/>
    <xsl:sequence select="if (string-length($text) gt $limit) then substring($text, 1, $limit) || '...' else $text"/>
  </xsl:function>

  <!-- a test's scenarios and its label: the outermost first -->
  <xsl:function name="x:path" as="xs:string">
    <xsl:param name="test" as="element(x:test)"/>
    <xsl:sequence select="string-join(($test/ancestor::x:scenario/x:label ! normalize-space(.), normalize-space($test/x:label)), ' > ')"/>
  </xsl:function>

  <xsl:template match="/">
    <xsl:variable name="tests" as="element(x:test)*" select="//x:test"/>
    <xsl:variable name="failed" as="element(x:test)*" select="$tests[@successful = 'false']"/>
    <xsl:variable name="pending" as="element(x:test)*" select="$tests[@pending]"/>
    <xsl:variable name="passed" as="element(x:test)*" select="$tests[@successful = 'true']"/>
    <xsl:value-of select="'XSpec: ' || count($passed) || ' passed, ' || count($failed) || ' failed, ' || count($pending) || ' pending - ' || count($tests) || ' tests&#10;'"/>
    <xsl:for-each select="$failed">
      <xsl:value-of select="'FAILED  ' || x:path(.) || '&#10;'"/>
      <xsl:value-of select="'  expected: ' || x:short(x:expect) || '&#10;'"/>
      <xsl:value-of select="'  actual:   ' || x:short(preceding-sibling::x:result[1]) || '&#10;'"/>
    </xsl:for-each>
    <xsl:for-each select="$pending">
      <xsl:value-of select="'PENDING ' || x:path(.) || ' - ' || @pending || '&#10;'"/>
    </xsl:for-each>
    <!-- a scenario that failed to run: XSpec reports it as an error, not as a failed test -->
    <xsl:for-each select="//x:scenario[x:error]">
      <xsl:value-of select="'ERROR   ' || string-join(ancestor-or-self::x:scenario/x:label ! normalize-space(.), ' > ') || ' - ' || x:short(x:error) || '&#10;'"/>
    </xsl:for-each>
  </xsl:template>
</xsl:stylesheet>
