<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:fn="namespace-uri"
                xmlns:ct="com.test"
                version="3.0">
  
  <xsl:variable name="test1" as="xs:integer" select="count(22)"/>
  <xsl:variable name="test2" as="map(xs:integer, map(xs:string, array(xs:integer*)))?" select="/*"/>
  <xsl:variable name="test3" as="xs:integer+" select="1"/>
  <xsl:variable name="test4" as="element(books)" select="/*"/>
  <xsl:variable name="test5" as="(function(element()) as xs:string)?" select="function($a as element()) as xs:string {local-name($a)}"/>
  <xsl:variable name="test6" as="xs:boolean" select="2 instance of array(function())"/>
  <xsl:variable name="test7" as="document-node(element(abc))" select="/* instance of element(books)"/>
  <xsl:variable name="test8" as="xs:anyAtomicType" select="1"/>
  <xsl:variable name="test9" as="xs:numeric" select="1"/>
  <xsl:variable name="test10" as="array(*)?" select="[]"/>
  <xsl:variable name="test11" as="map(*)" select="[]"/>
  <xsl:variable name="test12" as="array(map(xs:string, xs:integer))?" select="()"/>
  <xsl:variable name="test13" as="element(ct:book)" select="/*"/>
  <xsl:variable name="test14" as="attribute(book)" select="/*"/>
  <xsl:variable name="test15" as="attribute()" select="/*"/>
  <xsl:variable name="test16" as="attribute(*, xs:date)" select="//@*"/>
  <xsl:variable name="test17" as="element(*, xs:integer)" select="//*"/>
  <xsl:variable name="test18" as="element(as)" select="/*"/>
  <xsl:variable name="test19" as="function(*)" select="function() {}"/>
  
</xsl:stylesheet>