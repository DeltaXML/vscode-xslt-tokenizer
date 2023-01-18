<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    
    <xsl:template match="*" mode="#default">
        <xsl:variable name="test" as="xs:string" select="if (0) then 'b' else 'c'"/>    
    </xsl:template>
    
</xsl:stylesheet>