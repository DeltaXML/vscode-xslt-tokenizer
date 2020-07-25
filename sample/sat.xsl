<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                version="3.0">

    
    <xsl:template match="/*" mode="#default">
        <xsl:variable name="t1" as="xs:string" select="22"/>
        <xsl:sequence select="[] count(2)"/>
        <xsl:sequence select="[] 22"/>
        <xsl:sequence select="[] $t1"/>
        <xsl:sequence select="[] elementName"/>
        <xsl:sequence select="[] @attrName"/>
    </xsl:template>
            
</xsl:stylesheet>