<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform">  
    
    <xsl:variable name="$abc" as="xs:string" select="22"/>
    
    <xsl:variable name="tool" as="xs:string" select="map {$abc: 23}"/>
    
    <xsl:template match="/" mode="#default">
        <xsl:call-template name="get-unit-declarations">
            <xsl:with-param name="content-handler" tunnel="yes" as="element()">
                <unit-declaration/>
            </xsl:with-param>
        </xsl:call-template>
    </xsl:template>
    
    <xsl:template name="get-unit-declarations" as="">
        
    </xsl:template>
    
</xsl:stylesheet>