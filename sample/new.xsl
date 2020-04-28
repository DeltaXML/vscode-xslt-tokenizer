<xsl:template xmlns:xsl="abc" xmlns:xslt="abcd" xslt:test="abcd" match="pattern" mode="#default">
    <xsl:param name="p1" as="node()"/>
    <xsl:variable name="a" as="xs:integer" select="5"/> 
    <xsl:sequence select="$a, $b"/>
    <xsl:variable name="b" as="xs:integer" select="5"/>      
</xsl:template>
