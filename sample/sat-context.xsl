<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" 
                xmlns:fn="namespace-uri" 
                xmlns:dev="abc"
                version="3.0" 
                xmlns:xs="http://www.w3.org/2001/XMLSchema">  
    
    <xsl:variable name="abcde" as="xs:string" select="22"/>
    
    <xsl:template match="/" mode="#default">   
        <xsl:for-each select="*">
            <xsl:variable name="var0" as="xs:string" select="@dev:new"/>
            <xsl:variable name="var1" as="xs:string" select="$var0, @dev:new"/>
            <xsl:variable name="var2" as="xs:string" select="/, /new, ., 'a', $var0, $var1, root(), @class, last(), position()"/>
            <xsl:variable name="var8" as="xs:string" select="/"/>
            <xsl:apply-templates mode="a2"/>
            <xsl:variable name="var3" as="xs:string" select="
                //*,
                base-uri(),
                text(),
                last(), 
                position()"/>
            <xsl:variable name="abc" as="xs:string" select="$var1, $var2, $var3"/> 
            <xsl:sequence select="$abc"/>
        </xsl:for-each>    
    </xsl:template>
    
    <!-- <xsl:function name="fn:test" as="">
         <xsl:sequence select="/, /next"/>
         </xsl:function> -->
    
    <xsl:template match="fn:map" mode="indent" expand-text="yes">
        <xsl:value-of>
            <xsl:variable name="depth" select="
                count(ancestor::*) + 1,
                count(ancestor::*) + 2"/>
            <xsl:for-each select="*">
                <xsl:if test="position() gt 1">
                    <xsl:text>{$depth} of {last()} on {name()}</xsl:text>
                </xsl:if>
                <xsl:apply-templates select="snapshot(@key)" mode="key-attribute"/>
                <xsl:apply-templates mode="#current"/>
            </xsl:for-each>
        </xsl:value-of>
    </xsl:template>
    
</xsl:stylesheet> 