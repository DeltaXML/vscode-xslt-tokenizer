<?xml version="1.0" encoding="UTF-8"?>
<!-- XPath 4.0 item types: choice, enumeration, record and named item types, and fn(...) function types - errors in XPath 3.1 (keep test expressions in sync with xpItemTypesAs31.xsl) -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:ct="com.example.test"
                version="4.0">

  <?test-attribute as?>
  <xsl:variable name="choice1" as="(xs:date | xs:time | xs:dateTime)" select="()"/>
  <xsl:variable name="choice2" as="(map(*) | array(*))?" select="()"/>
  <xsl:variable name="choice3" as="(document-node() | element())+" select="()"/>
  <xsl:variable name="choice4" as="(xs:string | enum('a', 'b'))*" select="()"/>
  <xsl:variable name="choice5" as="(ct:complex | xs:string)?" select="()"/>
  <xsl:variable name="choice6" as="(xs:string | (xs:integer | xs:date))" select="()"/>
  <xsl:variable name="choice7" as="map(xs:string, (xs:integer | xs:date))" select="()"/>
  <xsl:variable name="choice8" as="(element(a) | attribute(b))*" select="()"/>
  <xsl:variable name="enum1" as="enum('NFC', 'NFD', 'NFKC', 'NFKD')" select="()"/>
  <xsl:variable name="enum2" as="enum('red')+" select="()"/>
  <xsl:variable name="record1" as="record(r as xs:double, i as xs:double)" select="()"/>
  <xsl:variable name="record2" as="record('first name', 'middle initial', 'last name')" select="()"/>
  <xsl:variable name="record3" as="record()" select="()"/>
  <xsl:variable name="record4" as="record(ssn as xs:string, emp as element(employee)?)*" select="()"/>
  <xsl:variable name="record5" as="record(a as record(b as xs:integer), c as (xs:string | xs:integer))" select="()"/>
  <xsl:variable name="record6" as="record(a? as xs:string, 'b c'? as xs:integer)" select="()"/>
  <xsl:variable name="record7" as="record(a)" select="()"/>
  <xsl:variable name="named1" as="ct:complex" select="()"/>
  <xsl:variable name="named2" as="ct:complex*" select="()"/>
  <xsl:variable name="fnType1" as="fn(xs:string) as xs:integer" select="()"/>
  <xsl:variable name="fnType2" as="(fn(xs:string) as xs:integer)?" select="()"/>
  <xsl:variable name="fnType3" as="function(xs:string) as xs:integer" select="()"/>
  <xsl:variable name="oldUnion1" as="union(xs:date, xs:time)" select="()"/>
  <xsl:variable name="oldType1" as="type(ct:complex)" select="()"/>
  <xsl:variable name="oldTuple1" as="tuple(a as xs:string)" select="()"/>
  <xsl:variable name="recordErr1" as="record(r as)" select="()"/>
  <xsl:variable name="recordErr2" as="record(*)" select="()"/>
  <xsl:variable name="recordErr3" as="record(a as xs:string, *)" select="()"/>
  <xsl:variable name="enumErr1" as="enum(red)" select="()"/>
  <xsl:variable name="choiceErr1" as="(xs:date | )" select="()"/>
</xsl:stylesheet>
