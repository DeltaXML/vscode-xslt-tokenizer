<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:fn="http://www.w3.org/2005/xpath-functions"
                xmlns:fnc="abc"
                exclude-result-prefixes="xs"
                xmlns:array="http://www.w3.org/2005/xpath-funkkkctions/array"
                    
            version="3.0">
    
    <xsl:import href="sat.xsl"/>   
    
    <xsl:variable name="test" as="xs:string" select="$map.new ! ?a"/>
    
    <xsl:variable name="map.new" as="xs:string" select="
        let $a := map {
                'a': ('test')
            } 
        return $a"/>
    
</xsl:stylesheet>