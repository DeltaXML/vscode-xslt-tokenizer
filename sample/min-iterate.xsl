<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="3.0">
  
  <xsl:template match="/*" mode="#all">
    <xsl:iterate select=".">
      <xsl:on-completion select="."/>
      <xsl:param name="test" as="" select="."/>
      <xsl:next-iteration>
        <xsl:with-param name="test" select="$test"/>
      </xsl:next-iteration>
      <xsl:break/>
    </xsl:iterate>
  </xsl:template>
  
  
  
</xsl:stylesheet>