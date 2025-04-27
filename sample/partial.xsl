<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:fn="com.functions"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    
    <xsl:function name="fn:new" as="xs:string">
        <xsl:variable name="test" as="function(*)" select="
            let $sum-of-squares := fold-right(?, 0, function($a, $b) { $a*$a + $b })
            return $sum-of-squares(1 to 3)"/> 
        
        <xsl:variable name="test2" as="xs:integer*" select="
            let $f := function ($seq, $delim) { fold-left($seq, '', concat(?, $delim, ?)) },
                $paf := $f(?, '.')
            return $paf(1 to 5)"/>
    </xsl:function>


    
</xsl:stylesheet>