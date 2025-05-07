<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:fn="namespace-uri"
                xmlns:ct="com.test"
                version="3.0">
     
     <?START type declarations with NO ERRORS?>
     <xsl:variable name="test1" as="xs:integer" select="count(22)"/>
     <xsl:variable name="test2" as="map(xs:integer, map(xs:string, array(xs:integer*)))?" select="/*"/>
     <xsl:variable name="test3" as="xs:integer+" select="1"/>
     <xsl:variable name="test4" as="element(books)" select="/*"/>
     <xsl:variable name="test5" as="(function(element()) as xs:string)?" 
          select="function($a as element()) as xs:string {local-name($a)}"/>
     <xsl:variable name="test6" as="xs:boolean" select="2 instance of array(function())"/>
     <xsl:variable name="test7" as="document-node(element(abc))" select="/* instance of element(books)"/>
     <xsl:variable name="test8" as="xs:anyAtomicType" select="1"/>
     <xsl:variable name="test9" as="xs:numeric" select="1"/>
     <xsl:variable name="test10" as="element(ct:book)" select="/*"/>

     
     <xsl:function name="fn:main" as="item()*">
          <xsl:param name="test70" as="xs:integer?"/>
          <xsl:sequence select="$test70"/>
     </xsl:function>
     <?END type declarations with NO ERRORS?>
     
     
     <?START type declarations WITH ERRORS?>
     <xsl:variable name="test1-error" as="xs:intege" select="count(22)"/>
     <xsl:variable name="test2-error" as="xs:map(xs:integeer, mapp(xs:sstring, aarray(*)))" select="/*"/>
     <xsl:variable name="test3-error" as="string" select="1"/>
     <xsl:variable name="test4-error" as="elejment('book')" select="/*"/>
     <xsl:variable name="test5-error" as="map(element() xs:integer*)*" select="/*"/>
     <xsl:variable name="test6-error" as="" select="'the `as` attribute is empty'"/>
     <xsl:variable name="test7-error" as="@name, =, 22 Q{abcd} /child::like" select="2"/>
     <xsl:variable name="test8-error" as="element(q:book)" select="/*"/>
     <xsl:variable name="test9-error" as="element('book')" select="/*"/>
     <xsl:variable name="test10-error" as="element(book" select="/*"/>
     <xsl:variable name="test12-error" as="map()" select="/*"/>
     <xsl:variable name="test13-error" as="xs:map(*)" select="/*"/>
     <xsl:variable name="test15-error" as="array( )" select="array{}"/>
     <xsl:variable name="test16-error" as="array()" select="array{}"/>
     <xsl:variable name="test17-error" as="map( )" select="map{}"/>
     <xsl:variable name="test18-error" as="map(xs:integer, xs:integer, xs:integer)" select="map{}"/>

     <?END type declarations WITH ERRORS?>
     
     <?START auto-complete test?>

     <!-- 
          1. the 'as' attribute below should be marked with an error
          2. type within the 'as' attribute, the auto-complete list should be triggered and populated properly
     -->
     <xsl:variable name="test1-autocomplate" as="" select="'a string'"/>
     <?END auto-complete test?>
     
</xsl:stylesheet>