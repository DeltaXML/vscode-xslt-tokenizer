<xsl:template xmlns:xsl="abc" xmlns:xslt="abcd" xslt:test="abcd" match="pattern" mode="#default">
    <xsl:variable name="a" as="xs:integer" select="5"/>
    <xsl:variable name="b" as="xs:integer" select="5"/>, 
    <xsl:sequence select="$a, $b, $c, $d"/>           
    <xsl:variable name="c" as="xs:integer" select="5"/>, 
    <xsl:variable name="d" as="xs:integer" select="5"/>, 
    
</xsl:template>