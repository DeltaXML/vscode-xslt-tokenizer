<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:fn="namespace-uri"
                xmlns:ct="com.test"
                xmlns:_ct="com.test"
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
  <xsl:variable name="qname1" select="book"/>
  <xsl:variable name="qname2" select="book.new"/>
  <xsl:variable name="qname3" select="book-new"/>
  <xsl:variable name="qname4" select="_book"/>
  <xsl:variable name="qname5" select="book1"/>
  <xsl:variable name="qname6-error" select="1book"/>
  <xsl:variable name="qname7" select="book_new"/>

  <xsl:variable name="qname8" select="ct:book"/>
  <xsl:variable name="qname9" select="_ct:book"/>
  <xsl:variable name="qname10" select="ct:book."/>
  <xsl:variable name="qname11" select="ct:book12.4"/>
  
  <xsl:variable name="bracedURILiteral1" select="Q{http://www.w3.org/2005/xpath-functions/math}name"/>
  <xsl:variable name="bracedURILiteral2" select="Q{}name"/>

  <!-- following tests SHOULD be highlighted as errors - but are not currently -->
  <xsl:variable name="bracedURILiteral3-BUG" select="Q{name"/>
  <xsl:variable name="bracedURILiteral4-BUG" select="Q{name}"/>
  <xsl:variable name="bracedURILiteral5-BUG" select="EQ{name}"/>
  <xsl:variable name="bracedURILiteral6-BUG" select="Q{urn:com.example}ct:name"/>
  <xsl:variable name="bracedURILiteral7-BUG" select="Q{name} name"/>
  <xsl:variable name="bracedURILiteral8-BUG" select="9 Q{name}name"/>
  <xsl:variable name="bracedURILiteral9-BUG" select="9Q{name}name"/>
  <xsl:variable name="bracedURILiteral10-BUG" select="book Q{name}name"/>

</xsl:stylesheet>