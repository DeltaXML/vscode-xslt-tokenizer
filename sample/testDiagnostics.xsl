<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    
    
    <!-- Simple expressions that should report an error -->  
    <xsl:variable name="t25" select="10 => /"/>
    <!-- <xsl:variable name="t21" select="22 /a"/>
    <xsl:variable name="t20" select="/a | ///"/>
    <xsl:variable name="t23" select="Q{com.examle}/new"/>
         <xsl:variable name="t24" select="/abc!/new"/>
    <xsl:variable name="a0" as="" select="if (22) return $t21"/>
    <xsl:variable name="ta" select="count(1)"/>
    <xsl:variable name="t22" select="@abc /new"/>
    <xsl:variable name="t2" select="a/ instance of 2"/>
    <xsl:variable name="t3" select="a/ instancexx of 2"/>
    
         <?tests?>
    <xsl:variable name="t6" select="for $a in b return c"/>
    <xsl:variable name="t7" select="a/ div 2"/>
    
         <?tests Simple expressions that are rightly reported as valid?>
    <xsl:variable name="t1" select="a/ 2"/>
    <xsl:variable name="t0" select="8 + /a"/>
    <xsl:variable name="t4" select="+ a"/>
         <xsl:variable name="t5" select="- a"/> -->
</xsl:stylesheet> 