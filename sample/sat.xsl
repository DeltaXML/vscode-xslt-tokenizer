<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform">  
    
    <xsl:variable name="test" as="xs:int" select="{a, 2, 2}"/>
    <?region?>
    <xsl:template match="/" mode="#default">
        <new name="this {test}"/>
    </xsl:template>
    <?endregion?>
    
</xsl:stylesheet>