<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform">  
    
    <xsl:template match="/" mode="#default">
        <xsl:iterate select=".">
            <xsl:param name="p1" as="xs:string" select="'abc'"/>
            <xsl:param name="p2" as="xs:int" select="22"/>
            
            <xsl:iterate select=".">
                <xsl:param name="t1" as="xs:string" select="'abc'"/>
                <xsl:param name="t2" as="xs:int" select="22"/>
                
                <xsl:apply-templates select=".">
                    <xsl:with-param name="my" as="" select="any"/>
                </xsl:apply-templates>
                
                <xsl:next-iteration>
                    <xsl:with-param name="t1" as="xs:string" select="$p1"/>
                </xsl:next-iteration>
            </xsl:iterate>
            
            <xsl:next-iteration>
                <xsl:with-param name="p1" as="xs:string" select="$p1"/>
            </xsl:next-iteration>
        </xsl:iterate>
    </xsl:template>
    
</xsl:stylesheet>