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

</xsl:stylesheet>