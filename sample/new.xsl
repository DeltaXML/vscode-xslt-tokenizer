<xsl:template xmlns:xsl="abc" xmlns:fn="def">

    <xsl:param name="p1" as="xs:integer" select="1"/>
    <xsl:variable name="v1" as="xs:integer" select="2"/>
    <xsl:function name="fn:name" as="xs:string">
        <xsl:param name="fp1" as="node()"/>        
    </xsl:function>
                
</xsl:template>
