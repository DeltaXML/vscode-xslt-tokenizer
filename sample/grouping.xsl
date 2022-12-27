<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:fn="com.test"
    exclude-result-prefixes="xs"
    version="2.0">
    
    <xsl:template match="/*">
        <xsl:analyze-string select="'the [quick] brown'" regex="\[(.*?)\]">
            <xsl:matching-substring>
                <cite><xsl:value-of select="regex-group(1)"/></cite>
            </xsl:matching-substring>
            <xsl:non-matching-substring>
                <xsl:value-of select="."/>
            </xsl:non-matching-substring>
        </xsl:analyze-string>
    </xsl:template>
    
</xsl:stylesheet>