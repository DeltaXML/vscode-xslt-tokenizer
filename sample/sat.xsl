<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:fn="namespace-uri" version="3.0" xmlns:xs="http://www.w3.org/2001/XMLSchema">  
    
    <xsl:variable name="abcde" as="xs:string" select="22"/>
    
    <xsl:variable name="tool" as="xs:string" select="map {$abcde: 23}"/>
    
    <xsl:template match="/" mode="#default">   
        <xsl:for-each select="*">
            <xsl:variable name="abc" as="xs:string" select="'a'"/>
            <xsl:variable name="abc2" as="xs:string" select="$abc || 'b'"/>
            <xsl:variable name="abc3" as="xs:string" 
                select="
                    if (true()) then
                        $abc
                    else 
                        $abc2 || $abcde"/>
            <xsl:variable name="abc4" as="xs:string" select="$abcde, $abc3 || 'b'"/>
            <xsl:variable name="var8" as="node()*" expand-text="yes">
                <row>
                    text {$abc}
                </row>
                <row>something</row>
            </xsl:variable>
            <xsl:sequence select="$abc4, $var8"/>
        </xsl:for-each>    
        <xsl:sequence select="fn:get-unit-declarations()"/>
        <xsl:sequence select="fn:get-unit-declarations2('abc')"/>
    </xsl:template>    
    
    <xsl:function name="fn:get-unit-declarations" as="">
        <xsl:sequence select="'a'"/>
    </xsl:function>
    <xsl:function name="fn:get-unit-declarations2" as="">
        <xsl:param name="new" as="xs:string"/>
        <xsl:sequence select="'a'"/>
    </xsl:function>
    
</xsl:stylesheet>