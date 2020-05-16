<xsl:stylesheet  
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:fn="abc"
    version="3.0">
    
    <xsl:import href="sat.xsl"/>
    
    <xsl:template match="pattern" mode="#default">
        <xsl:call-template name="tp1h">
            <xsl:with-param name="p1" as="element()" select="a"/>
            <xsl:with-param name="p2" as="element()" select="b"/>          
        </xsl:call-template>  
        
    </xsl:template>
    
    <xsl:template name="tp1h">
        <xsl:param name="p1" as="node()"/>
        <xsl:param name="p2" as="node()"/>
        
    </xsl:template>
    
    
</xsl:stylesheet>