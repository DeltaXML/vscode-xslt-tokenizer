<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                version="4.0">
  
  <xsl:variable name="also" as="xs:string" 
    select="for member $m in [(3,5,6), (8,12)] return sum($m)
"/>

</xsl:stylesheet>