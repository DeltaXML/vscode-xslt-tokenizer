<xsl:template match="pattern" mode="#default">
    <xsl:param name="p1" as="node()"/
    <xsl:copy>
        <xsl:apply-templates select="@*, node(), $p1" mode="#current"/>
    </xsl:copy>,
    
</xsl:template>
