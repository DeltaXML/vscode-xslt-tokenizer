<xsl:stylesheet  
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:fn="abc"
    version="3.0">
    
    <xsl:mode name="mainMode"/>
    
    <xsl:template name="tp1">
        <xsl:param name="p1" as="element()" select="a"/>
        <xsl:param name="p2" as="element()" select="b"/> 
        <xsl:sequence select="fn:name(1,2)"/>
        
    </xsl:template>
    
    <xsl:template match="/*" mode="def">
        
    </xsl:template>
    
    <xsl:template match="/" mode="mode1">
        <xsl:param name="mp1" as="element()" select="a"/>
        <xsl:param name="mp2" as="element()" select="b"/>          
    </xsl:template>
    
    <xsl:function name="fn:name" as="xs:string">
        <xsl:param name="fp1" as="node()"/>
        <xsl:param name="fp2" as="node()"/>
        
        <xsl:sequence select="'test'"/>
    </xsl:function>       
    
</xsl:stylesheet>