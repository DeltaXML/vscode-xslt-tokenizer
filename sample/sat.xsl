<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform">  
    
    <xsl:variable name="test" select="'a' and '&lt;and' and b"/>
    <xsl:variable name="test2" select='"a" and "&lt;and" and b'/>
    <xsl:mode name="m1"/>
    
    <xsl:template match="any" mode="newerMode">
        
    </xsl:template>
    
    <xsl:template match="/" mode="#default" xmlns:err="http://www.w3.org/2005/xqt-errors">
        <xsl:apply-templates select="test" mode="#current"/>
    </xsl:template>
    
</xsl:stylesheet>