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
    
    <xsl:variable name="test1" as="record(ssn as xs:string, emp as element(employee))" select="/*"/>
    <xsl:variable name="test2" as="union(xs:dateTime, xs:date, xs:time, xs:string)" select="/*"/>
    <xsl:variable name="test3" as="enum('NFC', 'NFD', 'NFKC', 'NFKD')" select="/*"/>
    <xsl:variable name="test4" as="type(my:complex)" select="/*"/>

    

</xsl:stylesheet>