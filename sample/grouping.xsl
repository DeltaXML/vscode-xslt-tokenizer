<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:fn="com.test"
    exclude-result-prefixes="xs"
    version="2.0">
    
    <xsl:key name="abc" match="book" use="@id"/>
    
    <xsl:variable name="test" select="key('abc', @id)"/>
    
    <xsl:template match="book">
        <xsl:for-each-group select="data" group-by="@id">
          <xsl:sequence select="fn:newName()"/>
        </xsl:for-each-group>
    </xsl:template>
    
    <xsl:function name="fn:newName">
        <xsl:sequence select="current-group()"/>
        <xsl:sequence select="current-grouping-key()"/>
    </xsl:function>
    
</xsl:stylesheet>