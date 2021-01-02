<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="3.0">
  
  <xsl:template match="/*" mode="#all">
    <test>
      <xsl:sequence select="2"/>      
      <xsl:call-template name="test"/>
    </test>
    <xsl:sequence select="2"/>
    <xsl:call-template name="test">      
    </xsl:call-template>
    <xsl:iterate select=".">
      <xsl:on-completion select="."/>
      <xsl:param name="test" as="" select="."/>
      <xsl:next-iteration>
        <xsl:with-param name="test" select="$test"/>
      </xsl:next-iteration>
      <xsl:break/>
    </xsl:iterate>
  </xsl:template>
  
  <xsl:template name="test" as="">
    
  </xsl:template>
  
  
  
</xsl:stylesheet>