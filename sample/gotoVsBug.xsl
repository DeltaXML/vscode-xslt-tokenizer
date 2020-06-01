<xsl:stylesheet  
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:fn="example.com"
    xmlns:deltaxml="test.deltaxml.com"
    version="3.0">
    
    <xsl:function name="fn:foo" as="xs:string">
        <xsl:param name="fp1" as="node()"/>
        <xsl:sequence select="'test'"/>
    </xsl:function> 
    
    <xsl:function name="fn:bar" as="xs:string">
        <xsl:param name="fp1" as="node()"/>
        <xsl:sequence select="'test'"/>
    </xsl:function>
    
    <xsl:function name="deltaxml:convert-attribute-namespace" as="xs:string">
        <xsl:param name="fp1" as="node()"/>
        <xsl:sequence select="'test'"/>
    </xsl:function> 
    
    <xsl:template match="/" mode="#all">
        <xsl:variable name="bad" select="fn:bar(fn:foo(.))"/>        
    </xsl:template>
                
</xsl:stylesheet>