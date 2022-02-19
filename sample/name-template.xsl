<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="3.0">
  
  <xsl:template name="tnamePlus">
    <xsl:param name="param1plusSave" as="xs:string"/>
    <xsl:param name="param2new" as="xs:string"/>
    <xsl:sequence select="$param1plusSave, $param2new"/>
  </xsl:template>
  
</xsl:stylesheet>