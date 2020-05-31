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
    
    <xsl:key name="book-id2" match="book" use="@id"/>
    
    <xsl:accumulator name="acc2" initial-value="2">
        <xsl:accumulator-rule match="test">
            <xsl:sequence select="$value + 1"/>
        </xsl:accumulator-rule>
        <xsl:accumulator-rule match="test2" select="count($value)"/>
    </xsl:accumulator>
    
    <xsl:variable name="import2" as="xs:integer" select="2"/>
    
    <xsl:template name="template2">
        <xsl:param name="p1" as="node()"/>
        <xsl:copy>
            <xsl:apply-templates select="@*, node()" mode="#current"/>
        </xsl:copy>
        
    </xsl:template>
    
    <xsl:function name="fx:function2" as="xs:string">
        <xsl:param name="p1" as="node()"/>
        <xsl:param name="p2" as="node()"/>
    </xsl:function>
    
    <xsl:function name="fx:function3" as="xs:string">
    </xsl:function>
    
    
    <xsl:template match="/" mode="#all">
        <xsl:copy>
            <xsl:apply-templates select="" mode="#current"/>
        </xsl:copy>        
    </xsl:template>
    
    
    
</xsl:stylesheet>