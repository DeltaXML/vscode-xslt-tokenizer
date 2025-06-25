<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:fn="http://www.w3.org/2005/xpath-functions"
                version="3.0">

  <?test-attribute select?>
  <!-- following 2 pending tests appears to be fixed - correclty marking token before 'if' as an error -->
  
  <xsl:variable name="type1" select="'a' instance of xs:string*"/>
  <xsl:variable name="nodeType1" select="'a' instance of (xs:string)*"/>
  <xsl:variable name="nodeType2" select=". instance of node()*"/>
  <xsl:variable name="nodeType3" select=". instance of (map())*"/>
  <xsl:variable name="nodeType4" select=". instance of (map(*))*"/>
  
  <xsl:variable name="anonFunction-PENDING" select="function(any) {}"/>
  <xsl:variable name="fnLiteralErr1-PENDING" select="function($x, node()) { $x * 2 }"/>
  <xsl:variable name="fnLiteralErr2-PENDING" select="function($x as xs:string*) { $x * 2 }"/>
  <xsl:variable name="fnLiteralErr3-PENDING" select="function($x as node()*) { $x * 2 }"/>
  <xsl:variable name="fnLiteralErr4-PENDING" select="function($x as *) { $x * 2 }"/>
  <xsl:variable name="fnLiteralErr5-PENDING" select="function(*) {}"/>
  <xsl:variable name="test" select="node()"/>
  <xsl:variable name="expressionErr9-PENDING" select="5 >> 2"/>
  <xsl:variable name="expressionErr26-PENDING" select="5 cast as node()*"/>
  <xsl:variable name="expressionErr26b-PENDING" select="5 castable as node()*"/>
  <xsl:variable name="expressionErr28b-PENDING" select="5 treat as 5"/>
  <xsl:variable name="expressionErr53b-PENDING" select="[1, 2, 3] => array:filter(function($i as xs:integer) as { $i mod 2 = 1 })"/>
  <xsl:variable name="closureErr1-PENDING" select="let $f := function($x as xs:string) { $x + 1 } as xs:integer return $f(10)"/>
  <xsl:variable name="posPredErr1-PENDING" select="(10, 20, 30)[]"/>

  <xsl:variable name="nodeTestErr1-PENDING" select="text(ANY)"/>
  <xsl:variable name="nodeTestErr4-PENDING" select="processing-instruction('xml-stylesheet', 'a')"/>

  <!-- VERIFY VARIABLE $X$X -->
  <xsl:variable name="letAnonFnInvoke-PENDING" select="let $f := function($x$x) { $x$x * 10 } return $f(7)"/>
  
</xsl:stylesheet>