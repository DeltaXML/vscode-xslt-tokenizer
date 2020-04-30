<xsl:template xmlns:xsl="abc" xmlns:xslt="abcd" xslt:test="abcd" match="pattern" mode="#default">
    <root>
        <xsl:param name="p1" as="node()"/>
        <xsl:variable name="ax" as="xs:integer" select="5"/>
        
        <xsl:variable name="b" as="xs:ingeter" select="2">
            <xsl:sequence select="$a, $b, $p1"/>
            <xsl:variable name="a" as="xs:integer" select="5"/>
            
            <xsl:variable name="b" as="xs:ingeter" select="2">
                <xsl:sequence select="$a, $b, $p1"/>
            </xsl:variable> 
            
            
            <xsl:variable name="q" as="xs:integer" select="1"/>
            <xsl:variable name="d" as="xs:integer" select="$q"/>
            
        </xsl:variable>       
    </root>
    
    <xsl:variable name="d" as="xs:integer" select="$c"/>
    
    <xsl:variable name="e" as="xs:integer" select="$c"/>
    
    
    
    <xsl:variable name="c" as="xs:integer" select="5">
        <abc>
        <xsl:sequence select="$d"/>
        </abc>
    </xsl:variable>
            
</xsl:template>
