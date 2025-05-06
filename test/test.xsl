<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math"
                xmlns:my="namespace-uri"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">

    <xsl:variable name="test" as="map()" select="count(22)"/>
    <xsl:variable name="test" as="map( )" select="count(22)"/>
    <xsl:variable name="test" as="map(xs:integer, xs:integer, xs:integer)" select="count(22)"/>
    <xsl:variable name="test" as="map(xs:integer, xs:integer)" select="count(22)"/>
    <xsl:variable name="test" as="map(*)" select="count(22)"/>
    <q:new>
        
    </q:new>

    

</xsl:stylesheet>