<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  exclude-result-prefixes="xs"
  version="2.0">
  
  <xsl:key name="idkey" match="div" use="@id"/>
  
  <xsl:template match="bibref">
    <xsl:variable name="name" select="."/>
    <xsl:apply-templates select="document('bib.xml')/key('idkey',$name)"/>
  </xsl:template>
  
</xsl:stylesheet>