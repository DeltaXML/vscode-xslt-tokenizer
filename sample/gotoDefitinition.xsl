<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/array/math"
                xmlns:fx="example.com"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    
    <xsl:output method="xml" indent="yes"/>  
    <xsl:mode on-no-match="shallow-copy"/>
    
    <xsl:import href="import-gotoDefitinition.xsl"/>
    
    <xsl:function name="fx:function1" as="xs:string">
        <xsl:param name="p1" as="node()"/>
        
    </xsl:function>
    
    <xsl:template name="template1">
        <xsl:param name="p1" as="node()"/>
        <xsl:copy>
            <xsl:apply-templates select="@*, node()" mode="#current"/>
        </xsl:copy>
        
    </xsl:template>
    
    <xsl:variable name="variable1" as="xs:integer" select="2"/>
    
    
    <xsl:template match="/" mode="#all">
        <xsl:copy>
            <xsl:apply-templates select="" mode="#current"/>
        </xsl:copy>
        <xsl:sequence select="$variable1"/>
        <xsl:sequence select="$import1"/>
        <xsl:sequence select="$import2"/>
        <xsl:sequence select="fx:function1(a)"/>
        <xsl:sequence select="fx:function2(a,b)"/>
        <xsl:sequence select="fx:function3()"/>
        <xsl:sequence select="fx:function1#1"/>
        <xsl:sequence select="fx:function2#2"/>
        <xsl:sequence select="fx:function3#0"/>
        <xsl:sequence select="tokenize('abc','') => fx:function1()"/>
        <xsl:sequence select="tokenize('abc','') => fx:function2(a)"/>
        
        <xsl:call-template name="template1">
            <xsl:with-param name="p1" as="xs:string"/>           
        </xsl:call-template> 
        
        <xsl:call-template name="template2">
            <xsl:with-param name="p1" as="xs:string"/>           
        </xsl:call-template> 
        
        <xsl:sequence select="for $range in 1 to 255
            return 
                288 +
                288 +
                290 +
                $range"/>
        
        
        
        
    </xsl:template>
    
    
    
</xsl:stylesheet>