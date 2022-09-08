<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:fn="com.test"
    exclude-result-prefixes="xs"
    version="2.0">
    
    <xsl:variable name="result" select="1 for $a in 1 to 20 return $a"/>
    <xsl:variable name="newCount" select="function ($a, $b) { $a + $b}"/>
    
    <xsl:function name="fn:pqr">
        <xsl:param name="new"/>
        <xsl:sequence select="1"/>
    </xsl:function>
    
    <xsl:template match="/*">
        <root>
            <xsl:sequence select="$result"/>
        </root>
    </xsl:template>
</xsl:stylesheet>