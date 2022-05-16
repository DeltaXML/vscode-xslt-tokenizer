<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="3.0">
  <xsl:import href="rename2.xsl"/>

  <xsl:variable name="var1" as="xs:integer" 
    select="for $trial in 1 to 20 return ($trial, $trial + 1)"/>
  <xsl:variable name="var2" as="xs:integer" select="$var1"/>
  <xsl:variable name="abc" as="xs:integer" 
    select="function ($first-param, $parm2) { $first-param, $parm2}"/>
  
  <!-- <xsl:variable name="test" as="xs:integer" select="let $a := 1, $b := 2 + $a return $b"/> -->
</xsl:stylesheet>