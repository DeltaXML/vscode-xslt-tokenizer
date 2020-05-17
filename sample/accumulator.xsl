<xsl:stylesheet  
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    version="3.0">
    
    <xsl:import href="key.xsl"/>

	 <xsl:accumulator name="a" initial-value="0">
   <xsl:accumulator-rule match="section" select="$value + 1"/>
</xsl:accumulator>

<xsl:template match="section">
   <xsl:value-of select="accumulator-before('a')"/>
      <xsl:value-of select="accumulator-after('a')"/>

   <xsl:apply-templates/>
</xsl:template>
    
</xsl:stylesheet>