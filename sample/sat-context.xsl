<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" 
                xmlns:fn="namespace-uri" 
                xmlns:dev="abc"
                version="3.0" 
                xmlns:xs="http://www.w3.org/2001/XMLSchema">  
    
    <xsl:variable name="abcde" as="xs:string" select="22"/>
    
    <xsl:template match="/" mode="#default">   
        <xsl:for-each select="*">
            <xsl:variable name="var0" as="xs:string" select="@dev:new"/>
            <xsl:variable name="var1" as="xs:string" select="@dev:new"/>
            <xsl:variable name="var2" as="xs:string" select="'a', $var0, $var1"/>
            <xsl:apply-templates/>
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
    
</xsl:stylesheet> 