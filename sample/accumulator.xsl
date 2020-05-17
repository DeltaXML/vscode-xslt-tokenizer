<xsl:stylesheet  
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    version="3.0">
    
    <xsl:import href="key.xsl"/>


<xsl:template match="section">
   <xsl:value-of select="accumulator-before('a')"/>
      <xsl:value-of select="accumulator-after('a')"/>

   <xsl:apply-templates/>
</xsl:template>
   
   <xsl:template match="bibref">
      <xsl:variable name="name" select="."/>
      <xsl:apply-templates select="document('bib.xml')/key('idkey',$name)"/>
   </xsl:template>
    
</xsl:stylesheet>