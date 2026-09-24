<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generates src/xpath40FunctionDetails.ts from the Saxon function library documentation:
    https://www.saxonica.com/documentation13/doc/functions.xml

  Output: one entry for each function in the fn, map, array and math namespaces that has an
  XPath 4.0 signature (i.e. XPath 3.1 functions with their 4.0 signatures, plus new 4.0 functions),
  excluding any that Saxon has not yet implemented. Optional parameters are shown with their
  default value, e.g. '$collation as xs:string? := fn:default-collation()'.

  Run with: npm run generate-xpath40-functions
-->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:f="http://www.saxonica.com/ns/doc/functions"
                xmlns:gen="com.deltaxml.xpath40.generator"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">

  <xsl:output method="text"/>

  <xsl:param name="source-url" as="xs:string" select="'https://www.saxonica.com/documentation13/doc/functions.xml'"/>

  <!-- namespace URI => name prefix used in the function data (fn functions are unprefixed) -->
  <xsl:variable name="prefixes" as="map(xs:string, xs:string)" select="map{
    'http://www.w3.org/2005/xpath-functions': '',
    'http://www.w3.org/2005/xpath-functions/map': 'map:',
    'http://www.w3.org/2005/xpath-functions/array': 'array:',
    'http://www.w3.org/2005/xpath-functions/math': 'math:'
    }"/>

  <xsl:template match="/">
    <xsl:variable name="functions" as="element(f:function)*" select="//f:function
      [map:contains($prefixes, string(f:name/@namespace))]
      [f:signatures/f:proto[f:in-spec = 'xpath40']]
      [not(gen:is-unimplemented(.))]"/>
    <xsl:text>/**
 *  Copyright (c) 2025 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */

/*
 NOTE: this code was auto-generated using resources/xslt/saxon-functions-to-typescript.xsl
 to transform the Saxon function library documentation: {$source-url}
 Do not edit - regenerate with: npm run generate-xpath40-functions
*/

import {{ FunctionCompletionData }} from './xsltTokenCompletions';

// XPath 4.0 functions: {count($functions)} entries
export const xpath40Data: FunctionCompletionData[] = [
</xsl:text>
    <xsl:for-each select="$functions">
      <xsl:variable name="proto" as="element(f:proto)" select="f:signatures/f:proto[f:in-spec = 'xpath40']"/>
      <xsl:variable name="name" as="xs:string" select="$prefixes(string(f:name/@namespace)) || f:name"/>
      <xsl:variable name="args" as="xs:string*" select="$proto/f:arg ! gen:arg(.)"/>
      <xsl:text>&#9;{{&#10;</xsl:text>
      <xsl:text>&#9;&#9;name: {gen:ts-string($name)},&#10;</xsl:text>
      <xsl:text>&#9;&#9;signature: {gen:ts-string($name || '(' || string-join($args, ', ') || ') as ' || normalize-space($proto/@return-type))},&#10;</xsl:text>
      <xsl:text>&#9;&#9;description: {gen:ts-string(normalize-space(f:description/f:p[1]))}&#10;</xsl:text>
      <xsl:text>&#9;}}{if (position() eq last()) then '' else ','}&#10;</xsl:text>
    </xsl:for-each>
    <xsl:text>];&#10;</xsl:text>
  </xsl:template>

  <xsl:function name="gen:arg" as="xs:string">
    <xsl:param name="arg" as="element(f:arg)"/>
    <!-- some types (e.g. long enum types) are split over several lines in the source -->
    <xsl:sequence select="'$' || $arg/@name || ' as ' || normalize-space($arg/@type) || (if ($arg/@default) then ' := ' || normalize-space($arg/@default) else '')"/>
  </xsl:function>

  <xsl:function name="gen:is-unimplemented" as="xs:boolean">
    <xsl:param name="function" as="element(f:function)"/>
    <xsl:sequence select="normalize-space($function/f:saxon-edition) eq 'NOT_IMPLEMENTED' or contains($function/f:status, 'Not yet implemented')"/>
  </xsl:function>

  <!-- a double-quoted TypeScript string literal -->
  <xsl:function name="gen:ts-string" as="xs:string">
    <xsl:param name="value" as="xs:string"/>
    <xsl:variable name="escaped" as="xs:string" select="$value
      => replace('\\', '\\\\')
      => replace('&quot;', '\\&quot;')
      => replace('&#10;', '\\n')
      => replace('[\r\t]', ' ')"/>
    <xsl:sequence select="'&quot;' || $escaped || '&quot;'"/>
  </xsl:function>

</xsl:stylesheet>
