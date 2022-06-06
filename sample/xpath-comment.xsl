<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"        
                version="3.0">
    
    <xsl:variable name="test" as="xs:string" 
        select="
            for $a in 1 to 20, (: newer:)
                $b in 2 to 3 return $a"/> 
    
    <xsl:variable name="new" as="xs:string" select="map {'new': 22, (: comment :) 'old': 23 (: comment:)}"/>
</xsl:stylesheet>