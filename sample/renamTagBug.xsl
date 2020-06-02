<xsl:stylesheet  
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:fn="example.com"
    version="3.0">
    


    <xsl:function name="fn:foo" as="xs:string">
        <xsl:param name="fp1" as="node()"/>
        <xsl:sequence select="'test'"/>
    </xsl:function> 
    
    <xsl:function name="fn:foo-bar" as="xs:string">
        <xsl:param name="fp1" as="node()"/>
        <xsl:sequence select="'test'"/>
    </xsl:function> 
    
    <xsl:template match="/" mode="#all">
        <xsl:variable select="fn:foo(test)"/>
        
    </xsl:variable>
                
</xsl:stylesheet>