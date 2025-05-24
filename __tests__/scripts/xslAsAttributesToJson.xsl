<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math"
                xmlns:ext="com.deltaxml.xpath.result.print"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
  
  <xsl:include href="../../xslt-resources/xpath-result-serializer/xpath-result-serializer-color.xsl"/>
	<xsl:output method="json" indent="yes"/>
  
  <xsl:template match="/" mode="#all">
    <xsl:map>
      <xsl:map-entry select="'xpInAsAttribute'" key="'suite'"/>
      <xsl:map-entry select="'XPath Lexer: tokens created within the XSLT ''as'' attribute'" key="'descriptor'"/>
      <xsl:map-entry select="'from: ' || static-base-uri()" key="'notes'"/>
      <xsl:map-entry key="'testCases'">
        <xsl:variable name="tests" as="array(*)*">
          <xsl:apply-templates select="*/xsl:variable"/>
        </xsl:variable>
        <xsl:variable name="result" select="array {$tests}"/>
        <xsl:message expand-text="yes">
        ==== Watch Variables ====
          tests:    {ext:print($tests,8,'  ')}
          result:   {ext:print($result,8,'  ')}
        </xsl:message>
        <xsl:sequence select="$result"/>
      </xsl:map-entry>
    </xsl:map>
  </xsl:template>
  
  <xsl:template match="xsl:variable" mode="#default">
    <xsl:sequence select="[string(@name), string(@as)]"/>
  </xsl:template>
  
</xsl:stylesheet>