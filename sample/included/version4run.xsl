<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                version="4.0">
  
  <xsl:item-type name="complex" as="record(r as xs:double, i as xs:double)"/>

  <xsl:template match="/*" mode="#default">
    <xsl:variable name="chars" as="xs:string*" select="characters('quick')"/>
    <result>
      <xsl:sequence select="count($chars)"/>
    </result>
  </xsl:template>

</xsl:stylesheet>