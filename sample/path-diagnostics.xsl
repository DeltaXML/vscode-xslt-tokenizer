<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:dx="com.deltaxml"
                version="3.0">
  
  <xsl:function name="dx:test" as="item()">
    <xsl:if test="*">
      <xsl:sequence select="text(), *, child::*, div, @class, ., .."/>
    </xsl:if>
  </xsl:function>  
  
</xsl:stylesheet>