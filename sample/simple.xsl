<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">  
    
    <xsl:variable name="var1" select="/*/@xml:*"></xsl:variable>
    
    <xsl:variable name="var2" select="$var1"/>
        
    

</xsl:stylesheet>