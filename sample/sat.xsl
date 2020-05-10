<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:fnc="abc"
                exclude-result-prefixes="xs"
                xmlns:array="http://www.w3.org/2005/xpath-funkkkctions/array"
                    
            version="3.0">
    
    <xsl:function name="fnc:test">
        <xsl:sequence select="1"/>
    </xsl:function>
    
    <xsl:variable name="test" select="
        let $a := fnc:test#0 return 1"/>
    
    <xsl:template match="/">
        <xsl:sequence select="'abc'"/>
    </xsl:template>
    
</xsl:stylesheet>