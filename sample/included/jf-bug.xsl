<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                version="3.0">
  
  <xsl:variable name="test" 
    select="                                
      let $spanFromAbove := 1,
        $spanAboveActive := if(true()) then 2 else 3
      return ($spanAboveActive, $spanFromAbove)
    "/>
  
  <xsl:variable name="test2"
    select="let $a := 2, $b := $a return ($a, $b)
    "/>
  <xsl:variable name="test3"
    select="let $a :=2, $b := if ($a) then 2 else $a return if ($a) then $a else $b
    "/>
  <xsl:variable name="test4"
    select="
    "/>
  <xsl:variable name="test5"
    select="
    "/>
  
</xsl:stylesheet>