<?xml version="1.0" encoding="UTF-8"?>
<!-- XPath 4.0 function syntax: fn and focus inline functions, keyword arguments, and namespace declarations - errors in XPath 3.1 (keep test expressions in sync with xpFunctionSyntax31.xsl) -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="4.0">

  <?test-attribute select?>
  <xsl:variable name="inlineFn1" select="fn($x) { $x * 2 }(3)"/>
  <xsl:variable name="inlineFn2" select="for-each((1, 2), fn($x) { $x + 1 })"/>
  <xsl:variable name="inlineFn3" select="fn($x as xs:integer, $y) as xs:integer { $x + $y }"/>
  <xsl:variable name="inlineFn4" select="fn() { 1 }"/>
  <xsl:variable name="inlineFn5" select="fold-left((1, 2, 3), 1, fn($x, $y) { $x * $y })"/>
  <xsl:variable name="focusFn1" select="fn { . * 2 }(3)"/>
  <xsl:variable name="focusFn2" select="function { . * 2 }(3)"/>
  <xsl:variable name="focusFn3" select="filter((1, 2, 3), fn { . gt 1 })"/>
  <xsl:variable name="focusFn4" select="sort((3, 1, 2), (), fn { -. })"/>
  <xsl:variable name="focusFn5" select="let $f := fn { string-length(.) } return $f('abc')"/>
  <xsl:variable name="keywordArg1" select="subsequence((1, 2, 3, 4), start := 2)"/>
  <xsl:variable name="keywordArg2" select="subsequence((1, 2, 3, 4), 2, length := 1)"/>
  <xsl:variable name="keywordArg3" select="subsequence((1, 2, 3, 4), length := 1, start := 2)"/>
  <xsl:variable name="keywordArg4" select="let $s := subsequence(start := ?, input := (1, 2, 3)) return $s(2)"/>
  <xsl:variable name="keywordArg5" select="fn:subsequence((1, 2), start := 1)"/>
  <xsl:variable name="keywordArg6" select="subsequence((1, 2, 3), start := let $a := 2 return $a)"/>
  <xsl:variable name="contextNsDecl1" select="declare namespace m = 'http://www.w3.org/2005/xpath-functions/math'; m:pi()"/>
  <xsl:variable name="contextNsDecl2" select="declare default element namespace 'urn:x'; count(//a)"/>
  <xsl:variable name="contextNsDecl3" select="declare default element namespace 'urn:x'; declare namespace p = 'com.example.p'; //p:a"/>
  <xsl:variable name="contextNsDecl4" select="declare namespace p = 'com.example.p'; declare namespace q = 'com.example.q'; //p:a/q:b"/>
  <xsl:variable name="focusFn6" select="fn { }()"/>
  <xsl:variable name="keywordArgError1" select="subsequence(start := 2, (1, 2, 3, 4))"/>
  <xsl:variable name="keywordArgError2" select="subsequence((1, 2, 3, 4), stat := 2)"/>
  <xsl:variable name="keywordArgError3" select="subsequence((1, 2), start := 1, start := 2)"/>
  <xsl:variable name="contextNsDeclError1" select="declare namespace p = 'com.example.p' //p:a"/>
  <xsl:variable name="contextNsDeclError2" select="declare namespace p = 'com.example.p'; declare default element namespace 'urn:x'; //a"/>
  <xsl:variable name="contextNsDeclError3" select="declare namespace p = 'com.example.p'; //q:a"/>
</xsl:stylesheet>
