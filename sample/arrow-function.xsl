<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    exclude-result-prefixes="xs"
    version="2.0">
    
    <xsl:variable name="newCount" select="function ($a, $b) { $a + $b}"/>
    <xsl:variable name="result" select="10 => $newCount(2)"/>
    <xsl:template match="/*">
        <root>
            <xsl:sequence select="$result"/>
        </root>
    </xsl:template>
</xsl:stylesheet>