<?xml version="1.0" encoding="UTF-8"?>
<!-- occurrence indicators on the types in 'treat as', 'instance of', 'cast as' and 'castable as' expressions -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="3.0">

  <?test-attribute select?>
  <xsl:variable name="seqType1" select="5 instance of xs:integer"/>
  <xsl:variable name="seqType2" select="5 instance of xs:integer?"/>
  <xsl:variable name="seqType3" select="(5, 6) instance of xs:integer*"/>
  <xsl:variable name="seqType4" select="(5, 6) instance of xs:integer+ and true()"/>
  <xsl:variable name="seqType5" select="(5, 6) treat as xs:integer+"/>
  <xsl:variable name="seqType6" select="'5' cast as xs:integer?"/>
  <xsl:variable name="seqType7" select="'5' castable as xs:integer?"/>
  <xsl:variable name="seqType8" select="(1 instance of xs:integer*, 2)"/>
  <xsl:variable name="seqType9" select="if (5 instance of xs:integer+) then 1 else 0"/>
  <!-- expect errors: -->
  <xsl:variable name="seqTypeError1" select="'5' cast as xs:integer*"/>
  <xsl:variable name="seqTypeError2" select="'5' castable as xs:integer+"/>
</xsl:stylesheet>
