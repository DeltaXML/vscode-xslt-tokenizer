<xsl:template xmlns:xsl="abc" xmlns:fn="def">

    <xsl:import href="included5.xsl"/>
    
    <xsl:param name="inc3p1" as="xs:integer" select="1"/>
    <xsl:variable name="inc3v1" as="xs:integer" select="2"/>
    <xsl:function name="fn:inc3name" as="xs:string">
        <xsl:param name="fp1" as="node()"/>        
    </xsl:function>
                
</xsl:template>