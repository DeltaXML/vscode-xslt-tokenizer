<xsl:stylesheet  
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:fn="abc"
    version="3.0">
    
    <xsl:import href="mode-test.xsl"/>
    
    <xsl:mode name="def"/>
    <xsl:mode name="mainMode"/>
    
    <xsl:template match="pattern" mode="#default"> 
        <xsl:apply-templates select="abc" mode="def"/>
    </xsl:template>
    
    <xsl:template match="/*" mode="def">
        
    </xsl:template>
    <xsl:template match="alt" mode="def">
        
    </xsl:template>
    
    
</xsl:stylesheet>