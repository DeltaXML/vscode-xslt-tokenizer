<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:dx="com.deltaxml"
    exclude-result-prefixes="xs"
    version="2.0"
    xmlns:oxy="http://www.oxygenxml.com/oxy">
    
    
    <xsl:template match="/*">
        <xsl:for-each select="//*">
            <xsl:message select="position()"/>
            <xsl:message select=".[@class eq current()/@class]"/>
        </xsl:for-each>
    </xsl:template>
    
    <xsl:function name="dx:text" as="xs:boolean">
        <xsl:message select="*/(.[@class eq current()/@class])"/>"/>
    </xsl:function>
    
    
</xsl:stylesheet>