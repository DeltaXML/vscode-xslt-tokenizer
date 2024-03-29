<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                version="3.0">    
    
    <new abc="one
              two
              three
              "/>
    
    <xsl:variable name="map" as="map(*)" select="
        map {
            'new': 5,
            'one': 1,
            'two': 3,
            'two': 2
        }"/>
    
    <xsl:variable name="new" as="xs:string*">
        <new attr="">
            <new/>
            <again new="abc"/>
        </new>
    </xsl:variable>
    
</xsl:stylesheet>   