<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:fn="namespace-uri" version="3.0" xmlns:xs="http://www.w3.org/2001/XMLSchema">  
    
    <xsl:function name="fn:test">
        <xsl:variable name="abcde" as="xs:string" select="for $a in (1) return ."/>   
    </xsl:function>
    
    <xsl:variable name="tool" as="xs:string" select="map {$abcde: 23}"/> 
    
    <xsl:template match="/" mode="#default">   
        <xsl:for-each select="*">
            <xsl:variable name="var1" as="xs:string" select="'a'"/>
            <xsl:variable name="var2" as="xs:string" select="
                'a', 
                $var1"/>
            <xsl:variable name="var3" as="xs:string" select="'a', $var2"/>
            <xsl:variable name="abc" as="xs:string" select="$var1, $var2, $var3"/>
            <xsl:variable name="abc2" as="xs:string" select="
                $abc || 'b' || 'dce'"/>
            <xsl:variable name="abc2" as="xs:string" select="
                if (2) then
                            ($abc, $abc2 || 'b' || 'dce')
                else 'something'"/>
            <xsl:variable name="abc3" as="xs:string" 
                select="
                    if (true()) then
                        $abc
                    else 
                        $abc2 || $abcde"/>
            <xsl:variable name="abc4" as="xs:string" select="$abcde/*, $abc3 || 'b'"/>
            <xsl:variable name="var8" as="node()*" expand-text="yes">
                <row>
                    text {$abc}
                </row>
                <row>something</row>
            </xsl:variable>
            <xsl:copy-of select="$abc4, $var8"/>
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