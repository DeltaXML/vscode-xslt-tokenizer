<xsl:template xmlns:xsl="abc" xmlns:xslt="abcd" xslt:test="abcd" match="pattern" mode="#default">
    <xsl:param name="p1" as="node()"/>
    <xsl:variable name="a" as="xs:integer" select="5"/>
    
    <xsl:sequence select="$a, $b"/>
    <xsl:sequence select="$a, $b"/>    
    <xsl:variable name="b" as="xs:integer" select="5"/>  
    
    <xsl:copy xmlns:xme="too">
        <xsl:apply-templates xmlns:xme="ok" xme:good="great" select="@*, node(), $p1" mode="#current"/>
        <xme:good/>
    </xsl:copy>
    
</xsl:template>
