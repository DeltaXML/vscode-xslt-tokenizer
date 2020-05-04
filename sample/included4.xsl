<xsl:template xmlns:xsl="abc" xmlns:fn="def">
    
    <xsl:param name="inc4p1" as="xs:integer" select="1"/>
    <xsl:variable name="inc4v1" as="xs:integer" select="2"/>
    <xsl:function name="fn:inc4name" as="xs:string">
        <xsl:param name="fp1" as="node()"/>        
    </xsl:function>
                
</xsl:template>