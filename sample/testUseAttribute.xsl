<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    
    <xsl:key name="abc" use="abc/@name"/>
    
    <xsl:template name="test">
        <xsl:context-item as="element()" use="optional"/>
        <xsl:copy-of select="current()"/>
    </xsl:template>
    
</xsl:stylesheet>