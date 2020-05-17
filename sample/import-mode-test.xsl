<xsl:stylesheet  
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:fn="abc"
    version="3.0">
    
    <xsl:import href="mode-test.xsl.xsl"/>
    
    <xsl:template match="pattern" mode="#default">
        <xsl:call-template name="tp1h">
            <xsl:with-param name="p1" as="element()" select="a"/>
            <xsl:with-param name="p2" as="element()" select="b"/>          
        </xsl:call-template>  
        
    </xsl:template>
    
    
</xsl:stylesheet>