<xsl:template xmlns:xsl="abc" xmlns:fn="def">
    <xsl:include href="included1.xsl"/>
    <xsl:import href="features/included2.xsl"/>
    <xsl:import href="features/included2x.xsl"/>
   
    <xsl:param name="p1" as="xs:integer" select="1"/>

    <xsl:variable name="va" as="xs:integer" select="2"/>
    <xsl:variable name="v1" as="xs:integer" select="$inc1p1"/>
    <xsl:variable name="v2" as="xs:integer" select="$inc2p1"/>
    <xsl:variable name="v3" as="xs:integer" select="$inc3p1"/>
    <xsl:variable name="v4" as="xs:integer" select="$inc4p1"/>
    <xsl:variable name="v5" as="xs:integer" select="$inc5p1"/>
    <xsl:variable name="v6" as="xs:integer" select="$inc6p1"/>
    
    <xsl:sequence select="$va, fn:name($v1), $v2, $v4, $v5, $v6"/>
    

    <xsl:function name="fn:name" as="xs:string">
        <xsl:param name="fp1" as="node()"/>      
    </xsl:function>
    <xsl:sequence select="$inc1v1"/>
    
                
</xsl:template>
