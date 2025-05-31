<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math"
                xmlns:ext="com.deltaxml.xpath.result.print"
                xmlns:fn="com.escape"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
  
  <xsl:include href="../../xslt-resources/xpath-result-serializer/xpath-result-serializer-color.xsl"/>
  <xsl:output method="json" indent="yes"/>
  
  <xsl:variable name="nameOfAttribute" as="xs:string" select="/*/processing-instruction(test-attribute)"/>
  <xsl:variable name="unicodeAmp" as="xs:integer" select="string-to-codepoints('&amp;')[1]"/>
  <xsl:variable name="unicodeEscapedAmp" as="xs:integer+" select="$unicodeAmp, string-to-codepoints('amp;')"/>
  
  <xsl:template match="/" mode="#all">
    <xsl:message select="'unicodeAmp', $unicodeAmp"/>
    <xsl:message select="'unicodeEscapedAmp', $unicodeEscapedAmp"/>
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
    <xsl:variable name="rawXPath" as="xs:string" select="string(@*[name() = $nameOfAttribute])"/>
    <xsl:variable name="withEscapedAmps" as="xs:string" select="fn:escapeAmp($rawXPath)"/>
    <xsl:sequence select="[string(@name), $withEscapedAmps]"/>
  </xsl:template>
  
  <xsl:template match="xsl:variable[select]" mode="#default">
    <xsl:variable name="rawXPath" as="xs:string" select="substring(select/text(), 2, string-length(select/text()) - 2)"/>
    <xsl:variable name="withEscapedAmps" as="xs:string" select="fn:escapeAmp($rawXPath)"/>
    <xsl:sequence select="[string(@name), $withEscapedAmps]"/>
  </xsl:template>
  
  <xsl:function name="fn:escapeAmp" as="item()*">
    <xsl:param name="test" as="xs:string"/>
    <xsl:variable name="escapedCodePoints" as="xs:integer*">
      <xsl:for-each select="string-to-codepoints($test)">
        <xsl:variable name="char" as="xs:integer" select="."/>
        <xsl:choose>
          <xsl:when test="$char eq $unicodeAmp">
            <xsl:sequence select="$unicodeEscapedAmp"/>  
          </xsl:when>
          <xsl:otherwise>
            <xsl:sequence select="$char"/>
          </xsl:otherwise>
        </xsl:choose>
      </xsl:for-each>
    </xsl:variable>
    <xsl:sequence select="codepoints-to-string($escapedCodePoints)"/>
  </xsl:function>
  
</xsl:stylesheet>