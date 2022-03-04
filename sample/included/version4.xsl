<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                version="4.0">
  
  <xsl:item-type name="complex" as="record(r as xs:double, i as xs:double)"/>
  <!-- <xsl:variable name="new" as="xs:string" select="parcel((2,2))"/> -->
  <xsl:variable name="also" as="xs:string" select="->($a, $b){$a + $b}, parcel(1)"/>
  <xsl:variable name="vtwo" as="xs:string" select="array:get(2,2)"/>
  <xsl:variable name="als2" as="xs:string" select="->{@code}, array:members(123,2,3,4)"/>
  <xsl:template match="/" mode="#default">

  </xsl:template>
  
  <xsl:function name="f:days-in-month" as="xs:integer?">
    <xsl:param name="month-number" as="xs:integer"/>
    <xsl:param name="leap-year" as="xs:boolean"/>
    <xsl:switch select="$month-number">
      <xsl:when test="1, 3, 5, 7, 8, 10, 12" select="31"/>
      <xsl:when test="4, 6, 9, 11" select="30"/>
      <xsl:when test="2">
        <xsl:if test="$leap-year" then="29" else="28"/>
      </xsl:when>
    </xsl:switch>
    <xsl:switch>
      <xsl:when test="">
        
      </xsl:when>
    </xsl:switch>
  </xsl:function>

</xsl:stylesheet>