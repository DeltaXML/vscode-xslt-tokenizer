<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:fn="namespace-uri">  
    
    <xsl:variable name="abcde" as="xs:string" select="22"/>
    
    <xsl:variable name="tool" as="xs:string" select="map {$abcde: 23}"/>
    
    <xsl:template match="/" mode="#default">
        
        <xsl:variable name="abc" as="xs:string" select="'a'"/>
        <xsl:variable name="abc2" as="xs:string" select="$abc || 'b'"/>
        <xsl:variable name="abc3" as="xs:string" select="$abc || $abc2 || 'c'"/>
        
        <xsl:sequence select="$abc3"/>
        <xsl:call-template name="get-unit-declarations">
            <xsl:with-param name="content-handler" tunnel="yes" as="element()">
                <unit-declaration/>
            </xsl:with-param>
        </xsl:call-template>
    </xsl:template>    
    
    <xsl:template name="get-unit-declarations" as="">
        
    </xsl:template>
    
</xsl:stylesheet>