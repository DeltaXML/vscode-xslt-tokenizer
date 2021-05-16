<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform">  
    
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