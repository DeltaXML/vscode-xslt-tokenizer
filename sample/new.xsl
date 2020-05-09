<xsl:template  
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:fn="def">
    
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
    
    <xsl:sequence select="$va, fn:name($v1), fn:inc1name($v2), $v4, $v5, $v6"/>
    <xsl:sequence select="array:head(2)"/>
    <xsl:sequence select="map:keys(2)"/>
    <xsl:sequence select="math:pow(2,3)"/>
    <xsl:sequence select="saxon:any(2,3)"/>
    <xsl:sequence select="['a', 'b', 'c'] => array:get(2)"/>
    
    
    

    <xsl:function name="fn:name" as="xs:string">
        <xsl:param name="fp1" as="node()"/>      
    </xsl:function>
    <xsl:sequence select="$inc1v1"/>
    
                
</xsl:template>
