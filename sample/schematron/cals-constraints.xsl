<?xml version="1.0" encoding="UTF-8"?>
<!-- Copyright 2011, 2013 DeltaXML Ltd.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.  -->

<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:xd="http://www.oxygenxml.com/ns/doc/xsl"
  xmlns:deltaxml="http://www.deltaxml.com/ns/well-formed-delta-v1"
  xmlns:cals="http://www.deltaxml.com/ns/cals-table"
  xmlns:saxon="http://saxon.sf.net/"
  exclude-result-prefixes="xs xd"
  version="2.0">
  
  <xd:doc scope="stylesheet">
    <xd:desc>
      <xd:p><xd:b>Created on:</xd:b> Sep 23, 2011</xd:p>
      <xd:p><xd:b>Author:</xd:b> tristanm</xd:p>
      <xd:p></xd:p>
    </xd:desc>
  </xd:doc>

  <!-- These functions are used in cals.sch as the basis for some simple assertions.
    They could probably be written directly in ISO schematron using the 
    XSLT2 binding and xsl:variable.  But they wouldn't be easily xspec testable. -->
  
  <xd:doc>
    <xd:desc>
      <xd:p></xd:p>
    </xd:desc>
    <xd:param name="tgroup"></xd:param>
    <xd:return></xd:return>
  </xd:doc>
    <xsl:function name="cals:unique-colspec-colnum" as="xs:boolean">
      <xsl:param name="tgroup" as="element()"/> 
      <xsl:value-of select="count(distinct-values($tgroup/*:colspec/@colnum)) eq count($tgroup/*:colspec/@colnum)"/>
    </xsl:function>
  
  <xd:doc>
    <xd:desc>
      <xd:p></xd:p>
    </xd:desc>
    <xd:param name="tgroup"></xd:param>
    <xd:return></xd:return>
  </xd:doc>
    <xsl:function name="cals:ascending-colnum" as="xs:boolean">
      <xsl:param name="tgroup" as="element()"/>
      <xsl:variable name="colnums" as="xs:positiveInteger*" select="$tgroup/*:colspec/@colnum"/>
      <xsl:variable name="test" as="xs:boolean*" select="for $i in 2 to count($colnums) return $colnums[$i] gt $colnums[$i - 1]"/>
      <xsl:value-of select="every $t in $test satisfies $t eq true()"/>
    </xsl:function>
  
  <xd:doc>
    <xd:desc>
      <xd:p></xd:p>
    </xd:desc>
    <xd:param name="tgroup"></xd:param>
    <xd:return></xd:return>
  </xd:doc>
    <xsl:function name="cals:colspec-range" as="xs:boolean">
      <xsl:param name="tgroup" as="element()"/>
      <xsl:choose>
        <xsl:when test="not(exists($tgroup/*:colspec/@colnum))">
          <xsl:value-of select="true()"/>
        </xsl:when>
        <xsl:otherwise>
          <xsl:variable name="minColnum" as="xs:integer" select="min(for $i in $tgroup/*:colspec/@colnum return (xs:integer($i)))"/>
          <xsl:variable name="maxColnum" as="xs:integer" select="max(for $i in $tgroup/*:colspec/@colnum return (xs:integer($i)))"/>
          <xsl:value-of select="$minColnum ge 1 and $maxColnum le count($tgroup/*:colspec)"/>
        </xsl:otherwise>
      </xsl:choose>
    </xsl:function>
  
  <xd:doc>
    <xd:desc>
      <xd:p></xd:p>
    </xd:desc>
    <xd:param name="tgroup"></xd:param>
    <xd:return></xd:return>
  </xd:doc>
    <xsl:function name="cals:cols-vs-colspecs" as="xs:boolean">
      <xsl:param name="tgroup" as="element()"/>
      <xsl:choose>
        <xsl:when test="not(exists($tgroup/*:colspec/@colnum))">
          <xsl:value-of select="true()"/>
        </xsl:when>
        <xsl:otherwise>
          <xsl:variable name="maxColnum" as="xs:integer" select="max(for $i in $tgroup/*:colspec/@colnum return (xs:integer($i)))"/>
          <xsl:value-of select="$maxColnum le xs:integer($tgroup/@cols)"/>
        </xsl:otherwise>
      </xsl:choose>
    </xsl:function>
  
</xsl:stylesheet>