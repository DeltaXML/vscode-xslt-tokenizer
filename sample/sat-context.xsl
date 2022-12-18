<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" 
                xmlns:fn="namespace-uri" 
                version="3.0" 
                xmlns:xs="http://www.w3.org/2001/XMLSchema">  
    
    <xsl:variable name="abcde" as="xs:string" select="22"/>
    
    <xsl:template match="/" mode="#default">   
        <xsl:for-each select="*" xmlns:dev="abc">
            <xsl:variable name="var1" as="xs:string" select="@dev:new, @*, @*:dev, dev:*, dev:*, @xml:space, @dev:new"/>
            <xsl:variable name="var2" as="xs:string" select="'a', $var1"/>
            <xsl:variable name="var3" as="xs:string" select="text()"/>
            <xsl:variable name="abc" as="xs:string" select="$var1, $var2, $var3"/> 
            <xsl:sequence select="$abc"/>
        </xsl:for-each>    
    </xsl:template>    
    
</xsl:stylesheet> 