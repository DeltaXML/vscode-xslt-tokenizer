<xsl:stylesheet  
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:fn="abc"
    expand-text="yes"
    version="3.0">

    
    <xsl:template match="/">
        <xsl:param name="mp2" as="element()" select="(2, $myvar, $myvar) + $"/> 
        <xsl:param name="mp1" as="element()" select="let $abcd := 25 return 2 + $abcd"/>
        <xsl:text></xsl:text>
        <xsl:variable name="test" as="xs:string" select="$mp2 + $default-features"/>
        <xsl:text>
            the {$mp1}
        </xsl:text>
        <xsl:call-template name="tmp1">
            <xsl:with-param name="" as="" select=""/>    
        </xsl:call-template>
    </xsl:template>
    
    <xsl:variable name="myvar" as="xs:string" select="unparsed-entity-uri('abc')"/>
    <xsl:accumulator name="test" as="xs:string">
        <xsl:accumulator-rule select="accumulator-before('test')"></xsl:accumulator-rule>    
    </xsl:accumulator>
    
    <xsl:variable name="default-features" select="
test" 
     as="element()*"/>
    
    <xsl:template name="tmp1" as="item()*">
        <xsl:param name="p1" as="" select=""/>
        <xsl:param name="p2" as="" select=""/>
        <xsl:param name="p3" as="" select=""/>
        <xsl:choose></xsl:choose>  
        <xsl:variable name="text" as="xs:string" select=""/>
        <xsl:call-template name="tmp1"/>
        <test xsl:use-attribute-sets="myattset"/>
    </xsl:template>
    
    <xsl:attribute-set name="myattset"></xsl:attribute-set>
    
    
    
    <xsl:function name="fn:name0" as="xs:string">        
        <xsl:sequence select="'test'"/>
    </xsl:function>  
    
    <xsl:function name="fn:name1" as="xs:string">
        <xsl:param name="fp1" as="node()"/>
        <xsl:sequence select="/alpha/[bravo[@yankee]/charlie/delta[@zulu]]"/>
        
        <xsl:sequence select="'test'"/>
    </xsl:function>    
    
    <xsl:function name="fn:name2" as="xs:string">
        <xsl:param name="fp1" as="node()"/>
        <xsl:param name="fp2" as="node()"/>
        
        <xsl:sequence select="'test'"/>
    </xsl:function>
    
    <xsl:function name="fn:name" as="xs:string">        
        <xsl:sequence select="'test'"/>
    </xsl:function>  
    
    <xsl:function name="fn:name" as="xs:string">
        <xsl:param name="fp1" as="node()"/>
        
        <xsl:sequence select="'test'"/>
    </xsl:function>    
    
    <xsl:function name="fn:name" as="xs:string">
        <xsl:param name="fp1" as="node()"/>
        <xsl:param name="fp2" as="node()"/>
        
        <xsl:sequence select="'test'"/>
    </xsl:function>  
    
</xsl:stylesheet>