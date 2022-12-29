<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" 
                xmlns:fn="namespace-uri" 
                version="3.0" 
                xmlns:xs="http://www.w3.org/2001/XMLSchema">  
    
    <xsl:variable name="max" as="xs:string" select="2 else 2"/>
    
    <xsl:template match="book" mode="indent" expand-text="yes">
        <xsl:value-of>
            <xsl:variable name="depth" select="count(ancestor::*) + 2"/>
            <xsl:for-each select="*">
                <xsl:if test="position() gt 1">
                    <xsl:text>{$depth} of {last()} on {name()}</xsl:text>
                    <max><xsl:value-of select="$max"/></max>
                </xsl:if>
                <xsl:apply-templates select="snapshot()"/>
                <xsl:apply-templates/>
            </xsl:for-each>
        </xsl:value-of>
    </xsl:template>
    
</xsl:stylesheet> 