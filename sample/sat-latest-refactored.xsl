<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" 
                xmlns:fn="namespace-uri" 
                version="3.0" 
                xmlns:xs="http://www.w3.org/2001/XMLSchema">  
    
    <xsl:variable name="max" as="xs:string" select="2"/>
    
    <xsl:template match="book" mode="indent" expand-text="yes">
        <xsl:value-of>
            <xsl:variable name="depth" select="count(ancestor::*) + 2"/>
            <xsl:for-each select="*">
                <xsl:sequence select="fn:extractFunction(., position(), last(), $depth)"/>
            </xsl:for-each>
        </xsl:value-of>
    </xsl:template>
    
    <xsl:function name="fn:extractFunction" expand-text="yes" as="item()*">
        <xsl:param name="c.x" as="item()*"/>
        <xsl:param name="c.p" as="xs:integer"/>
        <xsl:param name="c.l" as="xs:integer"/>
        <xsl:param name="depth" as="item()*"/>
        <xsl:if test="$c.p gt 1">
            <xsl:text>{$depth} of {$c.l} on {name($c.x)}</xsl:text>
            <max><xsl:value-of select="$max"/></max>
        </xsl:if>
        <xsl:apply-templates select="snapshot($c.x)"/>
        <xsl:apply-templates select="$c.x"/>
    </xsl:function>
    
</xsl:stylesheet> 