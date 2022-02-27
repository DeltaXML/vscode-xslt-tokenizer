<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="4.0">
  
  <xsl:item-type name="complex" as="record(r as xs:double, i as xs:double)"/>
  <!-- <xsl:variable name="new" as="xs:string" select="parcel((2,2))"/> -->
  <xsl:variable name="also" as="xs:string" select="->($a, $b){$a + $b}"/>
  <xsl:template match="/" mode="#default">

  </xsl:template>

</xsl:stylesheet>