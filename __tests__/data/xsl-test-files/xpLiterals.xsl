<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:fn="namespace-uri"
                xmlns:ct="com.test"
                expand-text="true"
                version="3.0">
  <!-- 
       This XSLT is used just as data to extract XPath strings
       The '&amp;' string is parsed as '&' but converted back to '&amp;' to generate the test
       The '£' character is replaced by a '&' character in a test
       The <select> element with a TVT is used where we need to preserve whitespace
  -->
  
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
  
  <xsl:variable name="string12" select="'one&#32;two'"/>
  <xsl:variable name="string13" select="'one&#xa0;two'"/>
  <xsl:variable name="string14" select="'one(:this:)two'"/>
  
  <xsl:variable name="string15">
    <select>{'
      one
      '}</select>
  </xsl:variable>
  
  <xsl:variable name="string16">
    <select>{
      'one 
      &amp;&amp; two'}</select>
  </xsl:variable>
  <xsl:variable name="string17">
    <select>{'
      one
      two
      three
      four'}</select>
  </xsl:variable>
  
  <!-- no error when space char follows '&amp;' and occurs before newline -->
  <xsl:variable name="string18">
    <select>{
      'one &amp; 
      two'}</select>
  </xsl:variable>
  <!-- issue #153 error when newline immediately follows '&amp;' -->
  <xsl:variable name="string19">
    <select>{
      'one &amp;
  two'}</select>
  </xsl:variable>
  
    <xsl:variable name="string20">
      <select>{
  "one &amp;
  two"}</select>
</xsl:variable>

</xsl:stylesheet>