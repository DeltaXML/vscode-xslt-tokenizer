<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                version="3.0">

    
    <xsl:template match="/*" mode="#default">
        <xsl:variable name="t1" as="xs:string" select="a &gt;&gt; b"/>
    </xsl:template>
            
</xsl:stylesheet>