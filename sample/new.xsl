<xsl:template match="fn:map" mode="no-indent">
    <xsl:value-of>
        <xsl:text>{</xsl:text>
        <xsl:for-each select="*">
            <xsl:if test="position() gt 1">
                <xsl:text>,</xsl:text>
            </xsl:if>
            <xsl:apply-templates select="snapshot(@key)" mode="key-attribute"/>
            <xsl:text>:</xsl:text>
            <xsl:apply-templates select="." mode="#current"/>
        </xsl:for-each>
        <xsl:text>}</xsl:text>
    </xsl:value-of>
</xsl:template>