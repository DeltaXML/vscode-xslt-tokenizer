<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:fn="namespace-uri"
                xmlns:ct="com.test"
                expand-text="true"
                version="3.0">
  
  <!-- inform script that generates unit-test data to use 'as' attribute -->
  <?test-attribute select?>
  <xsl:variable name="string1" select="'one'"/>
  <xsl:variable name="string2" select="'o''ne'"/>
  <xsl:variable name="string3" select="'o''ne'''"/>
  <xsl:variable name="string4" select="'''one'"/>
  
  <xsl:variable name="string5" select='"one"'/>
  <xsl:variable name="string6" select='"o""ne"'/>
  <xsl:variable name="string7" select='"o""ne""""'/>
  <xsl:variable name="string8" select='"""one"'/>
  
  <xsl:variable name="string9" select="'one &amp;amp; two'"/>
  <xsl:variable name="string10" select="'one &amp;amp;&amp;amp; two'"/>
  <xsl:variable name="string11" select="'one &amp;amp;amp; two'"/>
  
  <!-- <xsl:variable name="string12" select="'one 
       &amp; 
       two'"/> -->
  <xsl:variable name="string13">
    <select>{
      'one 
      &amp;&amp; two'}</select>
  </xsl:variable>
  <xsl:variable name="string14">
    <select>{'
    one
    two
    three
    four'}</select>
  </xsl:variable>
  
  <!-- no error when space char follows '&amp;' and occurs before newline -->
  <xsl:variable name="string15.1">
    <select>{
      'one &amp; 
      two'}</select>
  </xsl:variable>
  <!-- error when newline immediately follows '&amp;' -->
  <xsl:variable name="string15.2-error">
    <select>{
    'one &amp;
      two'}</select>
  </xsl:variable>

</xsl:stylesheet>