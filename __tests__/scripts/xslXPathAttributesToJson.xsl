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
  
  <xsl:variable name="nameOfAttribute" as="xs:string" select="/*/processing-instruction(test-attribute)"/>
  
  <xsl:template match="/" mode="#all">
    <xsl:variable name="result" as="map(*)">
      <xsl:map>
        <xsl:variable name="sourceFileName" as="item()*" select="tokenize(base-uri(), '/')[last()]"/>
        <xsl:map-entry select="substring($sourceFileName, 1, string-length($sourceFileName) - 4)" key="'suite'"/>
        <xsl:map-entry select="'XPath Lexer: expected tokens for each XSLT ' || $nameOfAttribute || ' attribute'" key="'description'"/>
        <xsl:map-entry select="$sourceFileName" key="'source'"/>
        <xsl:map-entry select="$nameOfAttribute" key="'attributeName'"/>
        <xsl:map-entry select="'from: ' || static-base-uri()" key="'notes'"/>
        <xsl:map-entry key="'testCases'">
          <xsl:variable name="tests" as="array(*)*">
            <xsl:apply-templates select="*/xsl:variable"/>
          </xsl:variable>
          <xsl:variable name="result" select="array {$tests}"/>
          <xsl:sequence select="$result"/>
        </xsl:map-entry>
      </xsl:map>
    </xsl:variable>
    <xsl:message expand-text="yes">
      ==== XSLT: {tokenize(static-base-uri(), '/')[last()]} ====
      xslt in:   {ext:print(tokenize(base-uri(), '/')[last()])}
      xslt attr: {ext:print($nameOfAttribute)}
      json out:  {ext:print($result,6,'  ')}
    </xsl:message>
    <xsl:sequence select="$result"/>
  </xsl:template>
  
  <xsl:template match="xsl:variable[@*/name() = $nameOfAttribute]" mode="#default">
    <xsl:sequence select="[string(@name), string(@as)]"/>
  </xsl:template>
  
</xsl:stylesheet>