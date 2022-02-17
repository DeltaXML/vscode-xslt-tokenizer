<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math"
                xmlns:fn="def"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    
    <xsl:function name="fn:inc6name" as="xs:string">
        <xsl:param name="fp1" as="node()"/>
        <xsl:call-template name="level3">
            <xsl:with-param name="inc3p1" as="xs:string" select="'new'"/>
        </xsl:call-template>
    </xsl:function>
        
    
    
</xsl:stylesheet>