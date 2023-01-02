<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:fn="abcd"
    exclude-result-prefixes="xs"
    version="2.0">
    
    <xsl:template match="/*">
        <xsl:sequence select="node(), current()/name(), last(), position(), ."/>
    </xsl:template>
    
    <xsl:function name="fn:test">
        <xsl:param name="c.x" as="node()"/>
        <xsl:sequence select="$c.x/current()"/>
    </xsl:function>
</xsl:stylesheet>