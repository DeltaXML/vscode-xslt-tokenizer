<xsl:template xmlns:xsl="abc" xmlns:fn="def">
   
    <xsl:param name="inc6p1" as="xs:integer" select="1"/>
    <xsl:variable name="inc6v1" as="xs:integer" select="2"/>
    <xsl:function name="fn:inc6name" as="xs:string">
        <xsl:param name="fp1" as="node()"/>        
    </xsl:function>
                
</xsl:template>