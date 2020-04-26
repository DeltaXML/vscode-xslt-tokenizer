<xsl:template xmlns:xsl="abc" xmlns:xslt="abcd" xslt:test="abcd" match="pattern" mode="#default">
    <xsl:param name="p1" as="node()"/>
    <xsl:copy xmlns:me="too">
        <xsl:apply-templates mex:good="great" select="@*, node(), $p1" mode="#current"/>
    </xsl:copy>,
    
</xsl:template>
