<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:fn="com.test"
                expand-text="yes"
                exclude-result-prefixes="xs"
                version="2.0">
    
    <xsl:template match="/*">
        <xsl:analyze-string select="'the [quick-lively] brown'" regex="\[([^\-]*?)-(.*?)\]">
            <xsl:matching-substring>
                <xsl:variable name="regex-group" select="map:merge(for $k in 0 to 10 return map:entry($k, regex-group($k)))"/>
                <xsl:message select="'map size', count(map:keys($regex-group))"/>
                <xsl:message select="'count-seq', $regex-group?*"/>
                <cite>{$regex-group(1)}</cite><cite2>{$regex-group(2)}</cite2>
            </xsl:matching-substring>
            <xsl:non-matching-substring>
                <xsl:value-of select="."/>
            </xsl:non-matching-substring>
        </xsl:analyze-string>
    </xsl:template>
    
</xsl:stylesheet>