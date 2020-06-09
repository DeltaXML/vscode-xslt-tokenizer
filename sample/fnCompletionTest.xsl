<xsl:stylesheet  
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:fn="abc"
    version="3.0">

    
    <xsl:template match="/">
        <xsl:param name="mp1" as="element()" select="@yankee[count(25)]  "/>
        <xsl:param name="mp2" as="element()" select=""/>          
    </xsl:template>
    
    
    <xsl:function name="fn:name0" as="xs:string">        
        <xsl:sequence select="'test'"/>
    </xsl:function>  
    
    <xsl:function name="fn:name1" as="xs:string">
        <xsl:param name="fp1" as="node()"/>
        <xsl:sequence select="/alpha/[bravo[@yankee]/charlie/delta[@zulu]"/>
        
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