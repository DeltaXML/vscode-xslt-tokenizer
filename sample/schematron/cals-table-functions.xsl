<?xml version="1.0" encoding="UTF-8"?>
<!-- Copyright 2010, 2012, 2013, 2016 DeltaXML Ltd.  All rights reserved. -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:deltaxml="http://www.deltaxml.com/ns/well-formed-delta-v1" 
                xmlns:xs="http://www.w3.org/2001/XMLSchema" 
                xmlns:dxa="http://www.deltaxml.com/ns/non-namespaced-attribute"
                xmlns:cals="http://www.deltaxml.com/ns/cals-table"
                xmlns:xd="http://www.oxygenxml.com/ns/doc/xsl"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:saxon="http://saxon.sf.net/"
                version="3.0" exclude-result-prefixes="#all">

  <xd:doc scope="stylesheet">
    <xd:desc>
      <xd:p>This stylesheet defines functions related to CALS tables.</xd:p>
      <xd:p>It is intended for inclusion by other XSLT filters and also schematron.</xd:p>
    </xd:desc>
  </xd:doc>
  
  <!-- use xsl:mode only for Saxon9.8 and later - XSLT 3.0 spec change -->
  <xsl:mode use-when="
    let $major := 9 return
    let $minor := 8 return 
    let $saxon-version := tokenize(system-property('xsl:product-version'),' ')[2] return
    let $version-numbers :=     
    ( 
      for $parts in tokenize($saxon-version,'\.') 
        return for $pn in xs:integer($parts) return $pn
    )
    return
    $version-numbers[1] ge $major and $version-numbers[2] ge $minor"
    
    use-accumulators="#all"/>
  
  <xsl:accumulator name="morerows-current-value" as="array(xs:integer)*" initial-value="()">
    <xsl:accumulator-rule match="*:tgroup|*:entrytbl" phase="start" select="(array { for $i in 1 to @cols return 0 }, $value)"/>
    <xsl:accumulator-rule match="*:tgroup|*:entrytbl" phase="end" select="tail($value)"/>
    <xsl:accumulator-rule match="*:row" phase="end" select="cals:update-row-array(., head($value)), tail($value)"/>
  </xsl:accumulator>
  
  <xd:doc>
    <xd:desc>
      <xd:p>Name dereferencing for cals attributes.</xd:p>
      <xd:p>Because you can't get from an attribute in XPath to its parent element, need two params</xd:p>
    </xd:desc>
    <xd:param name="elem">A table cell (entry/entrytbl) or a spanspec</xd:param>
    <xd:param name="attr">a column name referencing attribute in the above elem</xd:param>
    <xd:return>the colspec that the name refers to, or empty if does not exist</xd:return>
  </xd:doc>
  <xsl:function name="cals:lookup" as="element()?">
    <!-- returns the referenced entity or none if the element cant be found -->
    <!-- doesnt check for duplicate results, possibly another constraint/phase -->
    <xsl:param name="elem" as="element()"/> <!-- an entry, entrytbl or spanspec -->
    <xsl:param name="attr" as="attribute()"/> <!-- an @colname, @namest, @nameend or @spanname in the above elem -->
    <xsl:choose>
      <xsl:when test="$elem/parent::*:row/parent::*[self::*:thead or self::*:tfoot]/*:colspec">
        <!-- if an entry is in the context of a head/foot and that head/foot contains at least
          one colspec then all references are to that context, not the outer name space -->
        <xsl:sequence select="$elem/../../*:colspec[@colname=$attr]"/>
      </xsl:when>
      <!-- if the attr is colname, namest or nameend, it is referring to a colspec 
        the relevant colspec is in the nearest tgroup or entrytbl -->
      <xsl:when test="name($attr) = ('colname', 'namest', 'nameend')">
        <xsl:sequence select="$elem/ancestor::*[self::*:tgroup or self::*:entrytbl][1]/*:colspec[@colname=$attr]"/>
      </xsl:when>
      <!-- if the attr is spanname, it is referring to a spanspec 
        the relevant spanspec is in the nearest tgroup or entrytbl -->
      <xsl:when test="name($attr) eq 'spanname'">
        <xsl:sequence select="$elem/ancestor::*[self::*:tgroup or self::*:entrytbl][1]/*:spanspec[@spanname=$attr]"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:sequence select="error(QName('deltaxml', 'e2'), concat('referencing error for ', name($attr)))"/>
      </xsl:otherwise>
    </xsl:choose> 
  </xsl:function>
  
  <xd:doc>
    <xd:desc>
      <xd:p>Determines the column position for a colspec (1 based from left)</xd:p>
    </xd:desc>
    <xd:param name="col">A colspec</xd:param>
    <xd:return>It's position or index</xd:return>
  </xd:doc>
  <xsl:function name="cals:colnum" as="xs:integer">
    <xsl:param name="col" as="element()"/> <!-- element is a colspec -->
    <xsl:sequence select="if (exists($col/@colnum)) then $col/@colnum else 
      if ($col/preceding-sibling::*:colspec) then cals:colnum($col/preceding-sibling::*:colspec[1]) + 1 else 1"/>
  </xsl:function>
  
  <xd:doc>
    <xd:desc>
      <xd:p>Gives the columns occupied by an entry in terms of a sequence of integers corresponding to column positions</xd:p>
      <xd:p>If there are any referencing problems a 0 is returned (columns are normally numbered from 1).</xd:p>
      <!-- Related issue/comment: https://devtools.deltaxml.com/jira/browse/CORE-970?focusedCommentId=20303&page=com.atlassian.jira.plugin.system.issuetabpanels%3Acomment-tabpanel#comment-20303 -->
    </xd:desc>
    <xd:param name="entry">A table entry or entrytbl</xd:param>
    <xd:return>The occupied column(s) as a sequence of one or more integers</xd:return>
  </xd:doc>
  <xsl:function name="cals:entry-to-columns" as="xs:integer+">
    <xsl:param name="entry" as="element()"/> <!-- *:entry or *:entrytbl -->
    <xsl:param name="morerows" as="array(xs:integer)"/> <!-- one integer per col, where non-zero is overlap -->
    <xsl:choose>
      <xsl:when test="$entry/@spanname">
        <!-- look up span -->  <!-- cant be in a thead or tfoot -->
        <xsl:variable name="span" as="element()?" select="cals:lookup($entry, $entry/@spanname)"/>
        <xsl:variable name="fromCol" as="element()?" select="if (exists($span)) then cals:lookup($span, $span/@namest) else ()"/>
        <xsl:variable name="toCol" as="element()?" select="if (exists($span)) then cals:lookup($span, $span/@nameend) else ()"/>
        <xsl:sequence select="if (exists($span) and exists($fromCol) and exists($toCol)) then (cals:colnum($fromCol) to cals:colnum($toCol)) else (0)"/>
      </xsl:when>
      <xsl:when test="$entry/@namest and $entry/@nameend">
        <xsl:variable name="fromCol" as="element()?" select="cals:lookup($entry, $entry/@namest)"/>
        <xsl:variable name="toCol" as="element()?" select="cals:lookup($entry, $entry/@nameend)"/>
        <xsl:sequence select="if (exists($fromCol) and exists($toCol)) then (cals:colnum($fromCol) to cals:colnum($toCol)) else (0)"/>
      </xsl:when>
      <xsl:when test="$entry/@namest">
        <xsl:variable name="fromCol" as="element()?" select="cals:lookup($entry, $entry/@namest)"/>
        <xsl:sequence select="if (exists($fromCol)) then (cals:colnum($fromCol)) else (0)"/>
      </xsl:when>
      <xsl:when test="$entry/@colname">
        <xsl:variable name="col" as="element()?" select="cals:lookup($entry, $entry/@colname)"/>
        <xsl:sequence select="if (exists($col)) then (cals:colnum($col)) else (0)"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:sequence select="cals:get-default-col-pos2($entry, $morerows)"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>
  
  
  <xd:doc>
    <xd:desc>
      <xd:p>Determines where a table would be placed by default, ie when the @colname or @spanname
        attributes are not present or if they are ignored.  The default position depends on the
        position of the previous entry and also takes into account spanning or @morerows
        from columns in rows above.</xd:p>
    </xd:desc>
    <xd:param name="entry">A table cell</xd:param>
    <xd:return>its default position</xd:return>
  </xd:doc>

  <xsl:function name="cals:get-default-col-pos2" as="xs:integer">
    <xsl:param name="entry" as="element()"/> <!-- *:entry or *:entrytbl -->
    <xsl:param name="morerows" as="array(xs:integer)" />
    <!-- implict resolution -->
    <!-- what is col pos of last entry, add any morerows if they are adjacent, add 1-->
    <xsl:variable name="preceedingPos" as="xs:integer" 
      select="if ($entry/preceding-sibling::*[self::*:entry or self::*:entrytbl])
      then max(cals:entry-to-columns($entry/preceding-sibling::*[self::*:entry or self::*:entrytbl][1], $morerows))
      else xs:integer(0)"/>
    <xsl:variable name="candidatePos" as="xs:integer"
      select="$preceedingPos + 1"/>
    <xsl:variable name="cols" as="xs:integer" select="$entry/ancestor::*[@cols][1]/@cols"/>
    <xsl:variable name="nonOverlaps" as="xs:integer*"
      select="for $i in 1 to $cols return if ($morerows($i) eq 0) then $i else ()"/>
    <!-- nonOverlaps are the inverse of the overlaps - ie rows from above which do not have 
       a presence in the current row so if our candidate position is 'clear' we will use it, otherwise the next available position -->
    <xsl:variable name="nonOverlapsGECandidate" as="xs:integer*" select="$nonOverlaps[. ge $candidatePos]"/>
    <!-- if all the remaining possible positions are overlapped we're stuck - use cols+1 which is illegal as
          the result to pass out so that the calling code can report an error -->
    <xsl:sequence select="if (empty($nonOverlaps) and $candidatePos le $cols) then $candidatePos else if (count($nonOverlapsGECandidate) ge 1) then min($nonOverlapsGECandidate) else $cols+1"/>
  </xsl:function>

  <xd:doc>
    <xd:desc>
      <xd:p>Describes how a table row is spanned from above.</xd:p>
      <xd:p>This result is a set of columns which are overlapped from above in the row specified as
            an argument.  The 'set' is really a sequence and may be out of order, eg:  (3, 2).</xd:p>
      <xd:p>There may not be a one to one correspondence between the columns and @morerows attributes
        as the columns that descend with @morerows may also be wide columns using horizontal
        spanning (@spanname, @namest, @nameend etc).</xd:p>
    </xd:desc>
    <xd:param name="row">A table row</xd:param>
    <xd:return>A sequence of integers specifying which columns are spanned or 'infringed' from above</xd:return>
  </xd:doc>
  <xsl:function name="cals:overlap2" as="xs:integer*">
    <xsl:param name="row" as="element()"/>
    <xsl:variable name="row-data" as="array(xs:integer)" select="$row/accumulator-before('morerows-current-value')[1]"/>
    <xsl:sequence select="for $i in 1 to array:size($row-data) return if ($row-data($i) > 0) then $i else ()"/>
  </xsl:function>
  
  <xsl:function name="cals:update-row-array" as="array(xs:integer)">
    <xsl:param name="row" as="element()"/>
    <xsl:param name="old-values" as="array(xs:integer)"/>
    <xsl:variable name="rowmap" as="map(xs:integer, xs:integer)">
      <xsl:map>
        <xsl:for-each select="$row/*:entry[@morerows]">
          <xsl:variable name="coveredCols" as="xs:integer+" select="cals:entry-to-columns(., $old-values)"/>
          <xsl:sequence select="map:merge(for $i in $coveredCols return map:entry($i, xs:integer(@morerows)))"/>
        </xsl:for-each>
      </xsl:map>
    </xsl:variable>
    <xsl:sequence select="array { for $i in 1 to array:size($old-values) return max(($old-values($i)-1, $rowmap($i), 0)) }"/>
  </xsl:function>
</xsl:stylesheet>
