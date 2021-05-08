<?xml version="1.0" encoding="UTF-8"?>
<!-- Copyright 2011, 2013 DeltaXML Ltd.  All rights reserved. -->
<!-- $Id$ -->

<schema xmlns="http://purl.oclc.org/dsdl/schematron" xmlns:saxon="http://saxon.sf.net/"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform" queryBinding="xslt3" defaultPhase="structure">
  <ns prefix="xsl" uri="http://www.w3.org/1999/XSL/Transform" />
  <ns prefix="cals" uri="http://www.deltaxml.com/ns/cals-table"/>
  <ns prefix="saxon" uri="http://saxon.sf.net/" />
  <ns prefix="functx" uri="http://www.functx.com" />
  <ns prefix="map" uri="http://www.w3.org/2005/xpath-functions/map"/>
  <xsl:include xmlns:xsl="http://www.w3.org/1999/XSL/Transform" href="cals-table-functions.xsl" />
  <xsl:include xmlns:xsl="http://www.w3.org/1999/XSL/Transform" href="cals-constraints.xsl" />

  <xsl:function name="functx:value-intersect" as="xs:anyAtomicType*"
    xmlns:functx="http://www.functx.com">
    <xsl:param name="arg1" as="xs:anyAtomicType*" />
    <xsl:param name="arg2" as="xs:anyAtomicType*" />
    <xsl:sequence select="distinct-values($arg1[.=$arg2])" />
  </xsl:function>

  <!-- An ideal schematron implementation would run these 
    phases in order, only running later ones when the previous phases pass -->
  <phase id="context">
    <active pattern="p-context"/>
  </phase>
  <phase id="referencing">
    <active pattern="p-context"/>
    <active pattern="p-referencing" />
  </phase>
  <phase id="spansandcolspecs">
    <active pattern="p-context"/>
    <active pattern="p-referencing" />
    <active pattern="p-spansandcolspecs"/>
  </phase>
  <phase id="structure">
    <active pattern="p-context"/>
    <active pattern="p-referencing" />
    <active pattern="p-spansandcolspecs"/>
    <active pattern="p-structure"/>
  </phase>

  <pattern id="p-context">
    <rule context="*:thead">
      <assert role="warning" test="not(exists(*:row/*:entry/@spanname) and exists(*:colspec))">Use of the spanname attribute in a thead (<value-of select="saxon:path()"/>) is not allowed when local colspec elements are defined CALS-T5R1</assert>
    </rule>
    
    <rule context="*:tfoot">
      <assert role="warning" test="not(exists(*:row/*:entry/@spanname) and exists(*:colspec))">Use of the spanname attribute in a tfoot (<value-of select="saxon:path()"/>) is not allowed when local colspec elements are defined CALS-T6R1</assert>
    </rule>
    
    <rule context="*:tgroup">
      <assert test="cals:colspec-range(.)">colnum values within ('<xsl:value-of
        select="saxon:path()"/> must be in the range 1 to the number of colspecs CALS-T2R1C</assert>
      <assert test="if (@cols castable as xs:integer) then xs:integer(@cols) gt 0  else false()">The cols attribute is required on <xsl:value-of 
        select="saxon:path()"/> and its value must be an integer greater than zero CALS-1</assert>
      <assert test="count(distinct-values(*:colspec/@colname)) eq count(*:colspec/@colname)">The colnames of the colspecs in a tgroup (<xsl:value-of select="saxon:path()"/>) must be unique CALS-T10R4B</assert>
    </rule>
  </pattern>
  
  <pattern id="p-referencing">  
    <rule context="*:entry[@spanname]">
      <assert test="exists(cals:lookup(., @spanname))"><xsl:value-of select="saxon:path()"/> has no in-scope spanspec definition for the spanname reference '<xsl:value-of select="@spanname" />' CALS-T10R4A</assert>
    </rule>
    <rule context="*:entry[@colname]">
      <assert test="exists(cals:lookup(., @colname))"><xsl:value-of select="saxon:path()"/> has no in-scope colspec definition for the colname reference '<xsl:value-of select="@colname" />' CALS-T10R4A</assert>
    </rule>
    <rule context="*:entry[@namest or @nameend]">
      <assert test="if (@namest) then exists(cals:lookup(., @namest)) else true()"><xsl:value-of select="saxon:path()"/> has no in-scope colspec definition for the namest reference '<xsl:value-of select="@namest"/>' CALS-T10R4A</assert>
      <assert test="if (@nameend) then exists(cals:lookup(., @nameend)) else true()"><xsl:value-of select="saxon:path()"/> has no in-scope colspec definition for the nameend reference '<xsl:value-of select="@nameend"/>' CALS-T10R4A</assert>
    </rule>
  </pattern>
  

  <pattern id="p-spansandcolspecs">
    <!-- things in this phase are needed to prevent the cals:entry-to-columns function
      blowing up - you get empty sequence failures when start > end for example 
      Hence this phase is a pre-req for the strucutre phase -->
    <rule context="*:tgroup">
      <assert test="cals:unique-colspec-colnum(.)">Any colnums defined on colspecs within <xsl:value-of
        select="saxon:path()"/> must be unique CALS-T2R1A</assert>
      <assert test="cals:ascending-colnum(.)">Colnums within <xsl:value-of
        select="saxon:path()"/> must be in ascending order left-to-right CALS-T2R1B</assert>
      <assert test="cals:cols-vs-colspecs(.)">colnum values must not exceed the value of the cols attribute of the enclosing tgroup or entrytbl ('<xsl:value-of
        select="saxon:path()"/>') CALS-T2R1D</assert>
    </rule>
    <rule context="*:entry">
      <assert test="if (exists(@namest) and exists(@nameend)) then 
        cals:colnum(cals:lookup(., @namest)) lt cals:colnum(cals:lookup(., @nameend))
        else true()">In <xsl:value-of 
          select="saxon:path()"/> the column specified by the namest attribute (<xsl:value-of
            select="@namest" />) must be to the left of the column specified by nameend (<xsl:value-of
              select="@nameend" />) CALS-T10R4F</assert>
    </rule>
  </pattern>

  <pattern id="p-structure">
    <rule context="*:entry" >
      <xsl:variable name="row" as="element()" select="ancestor::*:row[1]"/>
      <xsl:variable name="morerows" as="array(xs:integer)" select="$row/accumulator-before('morerows-current-value')[1]"/>
      <assert test="every $e in following-sibling::*:entry
        satisfies empty(functx:value-intersect(cals:entry-to-columns(., $morerows), cals:entry-to-columns($e, $morerows)))">The <xsl:value-of select="saxon:path()"/> occupying column(s) (<xsl:value-of
          select="string-join(for $i in cals:entry-to-columns(., $morerows) return xs:string($i), ', ')"/>) overlaps some other entry or entries: <xsl:value-of
            select="string-join(for $e in following-sibling::*:entry return if (exists(functx:value-intersect(cals:entry-to-columns(., $morerows), cals:entry-to-columns($e, $morerows))))
            then concat(saxon:path($e), ' occupying (', string-join(for $i in cals:entry-to-columns($e, $morerows) return xs:string($i), ', '), ')') else (), ', ')" /> CALS-T10R4C</assert>

      <assert test="empty(functx:value-intersect(cals:entry-to-columns(., $morerows), cals:overlap2(parent::*:row)))">Column(s) (<xsl:value-of 
        select="functx:value-intersect(cals:entry-to-columns(., $morerows), cals:overlap2(parent::*:row))"/>) are occupied by both <xsl:value-of 
          select="saxon:path()"/> and by @morerows vertical straddling from above CALS-T10R4C</assert>
      <assert test="if (exists(@morerows)) then count(ancestor::*:row[1]/following-sibling::*:row) ge xs:integer(@morerows) else true()"><xsl:value-of 
        select="saxon:path()"/> specifies a morerows straddle value (<xsl:value-of 
          select="@morerows" />) which extends beyond the number of remaining rows (<xsl:value-of
            select="count(ancestor::*:row[1]/following-sibling::*:row)" />) in the enclosing <name path="../.."/> CALS-T10R4D</assert>
      
      
      <!-- an entry specifies a start column via entry's namest or colname that 
         is to the left of the column where the entry would be placed by default. -->
      <assert test="if (exists(@namest) or exists(@colname)) then 
        min(cals:entry-to-columns(., $morerows)) ge cals:get-default-col-pos2(., $morerows)
        else true()">Entry (<xsl:value-of
          select="saxon:path()"/>) specifies a start column (column <xsl:value-of
            select="min(cals:entry-to-columns(., $morerows))"/>) which is to the left (or less than in numeric terms) of the position it would be placed by default (column <xsl:value-of
              select="cals:get-default-col-pos2(., $morerows)"/>)</assert>
    </rule>
    
    <rule context="*:row">
      <let name="cols" value="ancestor::*[self::*:tgroup or self::*:entrytbl][1]/@cols" />
      <xsl:variable name="morerows" as="array(xs:integer)" select="accumulator-before('morerows-current-value')[1]"/>
      <xsl:variable name="occupied" select="for $e in *:entry return cals:entry-to-columns($e, $morerows)"
        as="xs:integer*" />
      <assert xml:space="default" test="if (exists($occupied)) then max($occupied) le xs:integer($cols) else true()">The number of occupied columns (<value-of 
        select="max($occupied)" />) in <xsl:value-of select="saxon:path()"/> must not exceed the number of columns (<value-of 
          select="$cols" />) specified on the <name path="../.." /> CALS-T10R4E</assert>
    </rule>

  </pattern>


</schema>
