<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:fn="com.test"
                expand-text="yes"
                exclude-result-prefixes="xs"
                version="2.0">
    
    <xsl:template match="/*">
        <xsl:analyze-string select="'the [quick-lively] brown'" regex="\[([^\-]*?)-(.*?)\]">
            <xsl:matching-substring>
                <xsl:variable xmlns:m="http://www.w3.org/2005/xpath-functions/map" name="regex-group" select="m:merge(for $k in 0 to 10 return m:entry($k, regex-group($k)))"/>
                <xsl:variable name="regex-group2" select="function($i as xs:integer) as xs:string {regex-group($i)}"/>
                <!-- <xsl:message select="'map size', count(map:keys($regex-group))" exclude-result-prefixes="map"/> -->
                <xsl:message select="'count-seq', $regex-group?*"/>
                <cite>{$regex-group(1)}</cite><cite2>{$regex-group2(2)}</cite2>
                <xsl:sequence select="fn:test(regex-group#1)"/>
            </xsl:matching-substring>
            <xsl:non-matching-substring>
                <xsl:value-of select="."/>
            </xsl:non-matching-substring>
        </xsl:analyze-string>
    </xsl:template>
    
    <xsl:function name="fn:test">
        <xsl:param name="fn" as="function(xs:integer) as xs:string"/>
        <also>{$fn(1)}</also>
    </xsl:function>
    
</xsl:stylesheet>