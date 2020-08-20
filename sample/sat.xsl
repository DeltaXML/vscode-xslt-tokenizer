<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform">  
    
    <xsl:variable name="test" select="'a' and '&lt;and' and b"/>
    <xsl:variable name="test2" select='"a" and "&lt;and" and b'/>
    
</xsl:stylesheet>