<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:fn="namespace-uri"
                xmlns:ct="com.test"
                version="3.0">
     
     <!-- Issues Tested:
          1. #144 https://github.com/DeltaXML/vscode-xslt-tokenizer/issues/144 (2 'regions')
          2. #146 https://github.com/DeltaXML/vscode-xslt-tokenizer/issues/146
          3. #147 https://github.com/DeltaXML/vscode-xslt-tokenizer/issues/147
          4  #148 https://github.com/DeltaXML/vscode-xslt-tokenizer/issues/148
     -->
     
     <?region 'as' attribute item types with NO ERRORS - ISSUE #144 (1/2) ?>
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
     <xsl:variable name="new" as="function(*)" select="function() {}"/>
     
     <xsl:function name="fn:main" as="item()*">
          <!-- no missing context-item error: -->
          <xsl:param name="test70" as="xs:integer?"/>
          <xsl:sequence select="$test70"/>
     </xsl:function>
     
     <!-- XPath 4.0 proposed types supported in Saxon 12: -->
     <xsl:variable name="XP4test1" as="record(ssn as xs:string, emp as element(employee))" select="/*"/>
     <xsl:variable name="XP4test2" as="union(xs:dateTime, xs:date, xs:time, xs:string)" select="/*"/>
     <xsl:variable name="XP4test3" as="enum('NFC', 'NFD', 'NFKC', 'NFKD')" select="/*"/>
     <xsl:variable name="XP4test4" as="type(ct:complex)" select="/*"/>
     <?endregion 'as' attribute item types with NO ERRORS?>
     
     
     <?region 'as' attribute item types WITH ERRORS - ISSUE #144 (2/2) ?>
     <xsl:variable name="test1-error" as="xs:intege" select="count(22)"/>
     <xsl:variable name="test1tvt-error" expand-text="yes" as="xs:intege" select="count(22)"/>
     <xsl:variable name="test2-error" as="arrayx(xs:string)" select="/*"/>
     <xsl:variable name="test3-error" as="string" select="1"/>
     <xsl:variable name="test4-error" as="element('book')" select="/*"/>
     <xsl:variable name="test5-error" as="map(element() xs:integer*)*" select="/*"/>
     <xsl:variable name="test6-error" as="" select="'the `as` attribute is empty'"/>
     <xsl:variable name="test7-error" as="@name" select="2"/>
     <xsl:variable name="test8-error" as="element(q:book)" select="/*"/>
     <xsl:variable name="test9-error" as="element('book')" select="/*"/>
     <xsl:variable name="test10-error" as="element(book" select="/*"/>
     <xsl:variable name="test12-error" as="map()" select="/*"/>
     <xsl:variable name="test13-error" as="xs:map(*)" select="/*"/>
     <xsl:variable name="test15-error" as="array( )" select="array{}"/>
     <xsl:variable name="test16-error" as="array()" select="array{}"/>
     <xsl:variable name="test17-error" as="map( )" select="map{}"/>
     <xsl:variable name="test18-error" as="map(xs:integer, xs:integer, xs:integer)" select="map{}"/>
     <xsl:variable name="test19-error" as="array(xs:integer, xs:integer)" select="array{}"/>
     <xsl:variable name="test20-error" as="attribute(*, xs:date, xs:integer)" select="/@*"/>
     <xsl:variable name="test21-error" as="element(*, xs:date, xs:integer)" select="*"/>
     
     <xsl:variable name="test22-error" as="as xs:integer" select="1"/>
     <xsl:variable name="test23-error" as="array(as)" select="1"/>
     <xsl:variable name="test24-error" as="array(*) as" select="1"/>
     <xsl:variable name="test25-error" as="as array(*)" select="1"/>
     
     <xsl:variable name="test27-error" as="function(book, library)" select="."/>
     <xsl:variable name="test29-error" as="element(?)" select="."/>     
     <xsl:variable name="test30-error" as="element(..)?" select="."/>
     <xsl:variable name="test31-error" as="function()" select="function() {}"/>
     <xsl:variable name="test32-error" as="element()()" select="function() {}"/>  
     <?endregion 'as' attribute item types WITH ERRORS?>
     
     <?region chained map-lookup: NO ERRORS - ISSUE #146?>    
     <!-- there should be no linter error reported in the expression: $a?books?book -->
     <xsl:variable name="test1-spuriouserror" as="xs:integer" 
          select="let $a := map { 'books': map { 'book': 1}} return $a?books?book"/>
     <?endregion chained map-lookup: NO ERRORS?>
          
     <?region auto-complete list includes 'xs:anyAtomicType' - ISSUE #147?>    
     <!-- 
          1. the 'xs:' in the 'as' attribute should be marked as an error
          2. place the cursor inside the attribute, after 'xs:'
          3. type the character 'a' - the auto-complete list should popup and include 'xs:anyAtomicType'
          4. pressing <enter> should result in the type being updated and no error should be shown for the token    
     -->
     <xsl:variable name="test1-aclistincludes" as="xs:" select="1"/>
     <?endregion auto-complete list includes 'xs:anyAtomicType'?>
     
     <?region auto-complete test - ISSUE #148?>    
     <!-- 
          1. the 'as' attribute below should be marked with an error because it is empty
          2. type within the 'as' attribute, the auto-complete list should be triggered and populated properly
     -->
     <xsl:variable name="test1-autocomplate" as="" select="'a string'"/>
     <?endregion auto-complete test?>
     
</xsl:stylesheet>