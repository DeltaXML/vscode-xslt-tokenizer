<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:p="com.example"
                version="3.0">
     
     <xsl:variable name="a" as="
                    map(xs:string, map(*))
                    " 
          select="map { }"/>
     <!-- <xsl:variable name="b" as="xs:integer" select="5"/>, 
          <xsl:variable name="new" select="$a, $b, $c, $d"/>           
          <xsl:variable name="c" as="xs:integer" select="5, $new"/>, 
          <xsl:variable name="d" as="xs:integer" select="5"/>,  -->
          
</xsl:stylesheet>