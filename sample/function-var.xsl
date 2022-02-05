<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math"
                xmlns:fun="urn:fun"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    
    <xsl:output method="xml" indent="yes"/>
    <xsl:mode on-no-match="shallow-copy"/>
    
    <xsl:template match="/*" mode="#all">
        <xsl:variable name="test" as="function(*)" select="function($s){$s}"/>
        <xsl:variable name="string" as="xs:string" select="'test' => $test('a')"/>
        <out>
            <xsl:value-of select="fun:test2($string, 'abc')"/>
        </out>
    </xsl:template>
    
    <xsl:function name="fun:test2">
        <xsl:param name="prm1" as="xs:string"/>
        <xsl:param name="prm2" as="xs:string"/>
        <xsl:sequence select="$prm1"/>
    </xsl:function>
    
</xsl:stylesheet>