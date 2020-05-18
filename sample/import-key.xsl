<xsl:stylesheet  
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:fn="abc"
    version="3.0">
    
    <xsl:import href="key.xsl"/>  
    
    <xsl:template match="pattern" mode="#default">
        <xsl:param name="p1" as="node()"/>
        <field xsl:use-attribute-sets="field-attributes">test</field>
        
        <xsl:copy use-attribute-sets="field-attributes">
            <xsl:apply-templates select="@*, node()" mode="#current"/>
        </xsl:copy>
        
    </xsl:template>
    
    
</xsl:stylesheet>