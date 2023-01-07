<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="3.0">
  <xsl:variable name="test" as="xs:s tring" select="'name'"/>
  <xsl:variable name="test2" as="xs:boolean" select="$test castable as map(xs:string, xs:integer)"/>
</xsl:stylesheet>