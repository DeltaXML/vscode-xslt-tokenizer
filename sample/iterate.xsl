<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
  
  <xsl:output method="xml" indent="yes"/>
  <xsl:mode on-no-match="shallow-copy"/>
  
  <xsl:template match="/*" mode="#all">
    <xsl:source-document streamable="yes" href="transactions.xml">
      <xsl:iterate select="transactions/transaction">
        <xsl:param name="balance" select="0.00" as="xs:decimal"/>
        <xsl:param name="prevDate" select="()" as="xs:date?"/>
        <xsl:variable name="newBalance" 
          select="$balance + xs:decimal(@value)"/>
        <xsl:variable name="thisDate" 
          select="xs:date(@date)"/>
        <xsl:choose>
          <xsl:when test="empty($prevDate) or $thisDate eq $prevDate">
            <balance date="{$thisDate}" 
                     value="{format-number($newBalance, '0.00')}"/>
            <xsl:next-iteration>
              <xsl:param name="" select=""/>
              <xsl:param name="abc" select="def"/>
            </xsl:next-iteration>
          </xsl:when>
          <xsl:otherwise>
            <xsl:break/>
          </xsl:otherwise>
        </xsl:choose>
      </xsl:iterate>
    </xsl:source-document>
  </xsl:template>
  
  <xsl:function name="test" as="">
    
  </xsl:function>
  
  
  
</xsl:stylesheet>