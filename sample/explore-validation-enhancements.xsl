<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math"
                xmlns:fn="namespace-uri"
                xmlns:fnq="http://example.com/functions"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    <!-- 
         1. xsl:param must occur first
         2. xsl:on-completion must occur before other instructions except xsl:param
         3. there must be only a single xsl:completion
         4. no xsl:instructions should follow an xsl:next-iteration
         5. an xsl:variable must have a 'name' attribute
    -->
    
    <xsl:output method="xml" indent="yes"/>
    <xsl:mode on-no-match="shallow-copy"/>
    
    <xsl:template match="/*" mode="#all">
        <xsl:variable/>
        <xsl:copy>
            <xsl:apply-templates select="@*, node()" mode="#current"/>
        </xsl:copy>
        <xsl:param name="name" as="item()*"/>
    </xsl:template>
    
    <xsl:function name="fnq:name" as="item()*">
        <xsl:variable name="some" as="xs:integer" select="1"/>
        <xsl:param name="name" as="item()*"/>
        
        <xsl:iterate select="1 to 2">
            <xsl:variable name="some" as="xs:integer" select="1"/>
            <xsl:param name="new" as="xs:boolean" select="true()"/>
            <xsl:on-completion select="22"/>
            <xsl:on-completion select="23"/>
            <xsl:next-iteration>
                <xsl:with-param name="" select=""/>
            </xsl:next-iteration>
        </xsl:iterate>
    </xsl:function>
    
    
    
</xsl:stylesheet>