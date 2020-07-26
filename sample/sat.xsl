<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:a="acb"
                version="3.0">

    
    <xsl:template match="*" mode="#default">
        <xsl:variable name="t1" as="xs:string" select="++2"/>
    </xsl:template>
            
</xsl:stylesheet>