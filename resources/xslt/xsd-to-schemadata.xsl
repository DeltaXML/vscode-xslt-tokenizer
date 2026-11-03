<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generates a SchemaData class (see src/xsltSchema.ts) from an XML Schema - e.g. one converted from RELAX NG by trang.
  Each element's definitions are flattened and merged by name: its attributes and child elements, through groups,
  attribute groups and type extensions, as SchemaQuery expects. An element defined in more than one context (e.g. a
  local element in different groups) gets the attributes and children of them all - looser than the schema, which is
  enough for a linter.

  e.g. for XSpec (src/xspecSchema.ts):
    java -jar trang.jar -I rnc -O xsd xspec.rnc xsd/xspec.xsd
    java -cp saxon.jar net.sf.saxon.Transform -xsl:resources/xslt/xsd-to-schemadata.xsl -s:xsd/xspec.xsd -o:src/xspecSchema.ts
         className=XSpecSchema docType=XSPEC prefix=x source="xspec.rnc from XSpec v4.1.2"
-->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:fxs="com.deltaxml.schema.functions"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">

  <xsl:output method="text"/>

  <xsl:param name="className" as="xs:string" required="yes"/>
  <xsl:param name="docType" as="xs:string" required="yes"/>
  <!-- the prefix for the schema's target namespace in the names generated -->
  <xsl:param name="prefix" as="xs:string" required="yes"/>
  <xsl:param name="source" as="xs:string" required="yes"/>

  <xsl:variable name="schema" as="element(xs:schema)" select="/xs:schema"/>
  <xsl:key name="group" match="xs:schema/xs:group" use="@name"/>
  <xsl:key name="attributeGroup" match="xs:schema/xs:attributeGroup" use="@name"/>
  <xsl:key name="complexType" match="xs:schema/xs:complexType" use="@name"/>
  <xsl:key name="simpleType" match="xs:schema/xs:simpleType" use="@name"/>
  <xsl:key name="element" match="xs:schema/xs:element" use="@name"/>

  <xsl:template match="/">
    <!-- an abstract element is never in a document: its substitution group's elements are (see fxs:children) -->
    <xsl:variable name="elements" as="element(xs:element)*" select="//xs:element[@name][not(@abstract = 'true')]"/>
    <xsl:text expand-text="no">/**
 *  Copyright (c) 2026 DeltaXignia Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */

/*
 NOTE: this code was auto-generated using resources/xslt/xsd-to-schemadata.xsl
</xsl:text>
    <xsl:text> from {$source}
*/

import {{ SchemaData, ComplexType, SimpleType }} from './xsltSchema';
import {{ DocumentTypes }} from './xslLexer';

export class {$className} implements SchemaData {{
    docType = DocumentTypes.{$docType};
    simpleTypes: {{ [name: string]: SimpleType }} = {{
</xsl:text>
    <xsl:for-each select="xs:schema/xs:simpleType[exists(fxs:enumerations(.))]">
      <xsl:value-of select="fxs:simpleType(fxs:name(@name), .)"/>
    </xsl:for-each>
    <xsl:for-each select="$elements">
      <xsl:variable name="elementName" select="fxs:name(@name)"/>
      <xsl:for-each select="fxs:attributes(.)[xs:simpleType][exists(fxs:enumerations(xs:simpleType))]">
        <xsl:value-of select="fxs:simpleType($elementName || '.' || @name, xs:simpleType)"/>
      </xsl:for-each>
    </xsl:for-each>
    <xsl:text>    }};
    complexTypes: {{ [name: string]: ComplexType }} = {{}};
    attributeGroups: {{ [name: string]: any }} = {{}};
    elements: {{ [name: string]: ComplexType }} = {{
</xsl:text>
    <xsl:for-each-group select="$elements" group-by="fxs:name(@name)">
      <xsl:sort select="current-grouping-key()"/>
      <xsl:variable name="elementName" select="current-grouping-key()"/>
      <xsl:variable name="attributes" as="element(xs:attribute)*" select="current-group() ! fxs:attributes(.)"/>
      <xsl:variable name="children" as="xs:string*" select="distinct-values(current-group() ! fxs:children(.))"/>
      <xsl:variable name="detail" as="xs:string?" select="(current-group()/xs:annotation/xs:documentation)[1] ! fxs:detail(.)"/>
      <xsl:variable name="attrs" as="xs:string*">
        <xsl:for-each-group select="$attributes" group-by="@name">
          <xsl:sequence select="'''' || @name || ''': ''' || fxs:attributeType(., $elementName) || ''''"/>
        </xsl:for-each-group>
      </xsl:variable>
      <xsl:variable name="properties" as="xs:string*" select="
        (if (exists($attrs)) then 'attrs: { ' || string-join($attrs, ', ') || ' }' else ()),
        (if (exists($children)) then 'elementNames: [' || string-join($children ! ('''' || . || ''''), ', ') || ']' else ()),
        (if (current-group()//xs:anyAttribute[not(@namespace = 'http://www.w3.org/XML/1998/namespace')]) then 'anyAttribute: true' else ()),
        (if (exists($detail)) then 'detail: `' || $detail || '`' else ())"/>
      <xsl:text>        '{$elementName}': {{ {string-join($properties, ', ')} }},
</xsl:text>
    </xsl:for-each-group>
    <xsl:text>    }};
}}
</xsl:text>
  </xsl:template>

  <!-- a name in the target namespace, with the prefix - or a QName from the schema, e.g. x:label or p:document -->
  <xsl:function name="fxs:name" as="xs:string">
    <xsl:param name="name" as="xs:string"/>
    <xsl:sequence select="if (contains($name, ':')) then $name else $prefix || ':' || $name"/>
  </xsl:function>

  <!-- the definitions of an element's content: its complex type, local or named -->
  <xsl:function name="fxs:content" as="element()*">
    <xsl:param name="element" as="element(xs:element)"/>
    <xsl:sequence select="$element/xs:complexType, $element/@type ! key('complexType', fxs:localName(.), $schema)"/>
  </xsl:function>

  <xsl:function name="fxs:localName" as="xs:string">
    <xsl:param name="qname" as="xs:string"/>
    <xsl:sequence select="replace($qname, '^.*:', '')"/>
  </xsl:function>

  <!-- the components within a definition, not within a local element's own definition -->
  <xsl:function name="fxs:components" as="element()*">
    <xsl:param name="definition" as="element()"/>
    <xsl:sequence select="$definition/descendant::*[not(ancestor::xs:element[. >> $definition])][not(self::xs:annotation or ancestor::xs:annotation)]"/>
  </xsl:function>

  <xsl:function name="fxs:attributes" as="element(xs:attribute)*">
    <xsl:param name="element" as="element(xs:element)"/>
    <xsl:sequence select="fxs:content($element) ! fxs:attributesIn(., ())"/>
  </xsl:function>

  <xsl:function name="fxs:attributesIn" as="element(xs:attribute)*">
    <xsl:param name="definition" as="element()"/>
    <xsl:param name="visited" as="xs:string*"/>
    <xsl:for-each select="fxs:components($definition)">
      <xsl:choose>
        <xsl:when test="self::xs:attribute[@name]">
          <xsl:sequence select="."/>
        </xsl:when>
        <xsl:when test="self::xs:attributeGroup[@ref] and not(@ref = $visited)">
          <xsl:sequence select="key('attributeGroup', fxs:localName(@ref), $schema) ! fxs:attributesIn(., ($visited, @ref))"/>
        </xsl:when>
        <xsl:when test="self::xs:extension[@base] and not(@base = $visited)">
          <xsl:sequence select="key('complexType', fxs:localName(@base), $schema) ! fxs:attributesIn(., ($visited, @base))"/>
        </xsl:when>
      </xsl:choose>
    </xsl:for-each>
  </xsl:function>

  <xsl:function name="fxs:children" as="xs:string*">
    <xsl:param name="element" as="element(xs:element)"/>
    <xsl:sequence select="fxs:content($element) ! fxs:childrenIn(., ())"/>
  </xsl:function>

  <xsl:function name="fxs:childrenIn" as="xs:string*">
    <xsl:param name="definition" as="element()"/>
    <xsl:param name="visited" as="xs:string*"/>
    <xsl:for-each select="fxs:components($definition)">
      <xsl:choose>
        <xsl:when test="self::xs:element[@name]">
          <xsl:sequence select="fxs:name(@name)"/>
        </xsl:when>
        <xsl:when test="self::xs:element[@ref]">
          <xsl:sequence select="fxs:substitutes(fxs:name(@ref))"/>
        </xsl:when>
        <xsl:when test="self::xs:group[@ref] and not(@ref = $visited)">
          <xsl:sequence select="key('group', fxs:localName(@ref), $schema) ! fxs:childrenIn(., ($visited, @ref))"/>
        </xsl:when>
        <xsl:when test="self::xs:extension[@base] and not(@base = $visited)">
          <xsl:sequence select="key('complexType', fxs:localName(@base), $schema) ! fxs:childrenIn(., ($visited, @base))"/>
        </xsl:when>
        <xsl:when test="self::xs:any">
          <!-- elements from other namespaces, e.g. a document's content -->
          <xsl:sequence select="'xs:any'"/>
        </xsl:when>
      </xsl:choose>
    </xsl:for-each>
  </xsl:function>

  <!-- the element, or for an abstract element, the elements in its substitution group -->
  <xsl:function name="fxs:substitutes" as="xs:string*">
    <xsl:param name="name" as="xs:string"/>
    <xsl:variable name="element" as="element(xs:element)?" select="key('element', fxs:localName($name), $schema)[starts-with($name, $prefix || ':')]"/>
    <xsl:sequence select="
      if ($element/@abstract = 'true') then
        $schema/xs:element[@substitutionGroup ! fxs:name(.) = $name] ! fxs:substitutes(fxs:name(@name))
      else $name"/>
  </xsl:function>

  <!-- an attribute's type: a named type, an enumeration generated for it, or none -->
  <xsl:function name="fxs:attributeType" as="xs:string">
    <xsl:param name="attribute" as="element(xs:attribute)"/>
    <xsl:param name="elementName" as="xs:string"/>
    <xsl:sequence select="
      if ($attribute/@type) then fxs:name($attribute/@type)
      else if ($attribute/xs:simpleType[exists(fxs:enumerations(.))]) then $elementName || '.' || $attribute/@name
      else ''"/>
  </xsl:function>

  <!-- the values of a simple type that is only an enumeration - not a union with other types, whose other values
       would be reported -->
  <xsl:function name="fxs:enumerations" as="xs:string*">
    <xsl:param name="simpleType" as="element(xs:simpleType)"/>
    <xsl:sequence select="$simpleType[not(.//xs:union)]/xs:restriction/xs:enumeration/@value"/>
  </xsl:function>

  <xsl:function name="fxs:simpleType" as="xs:string">
    <xsl:param name="name" as="xs:string"/>
    <xsl:param name="simpleType" as="element(xs:simpleType)"/>
    <xsl:variable name="documented" as="xs:string*" select="
      $simpleType/xs:restriction/xs:enumeration[xs:annotation/xs:documentation] !
        ('''' || @value || ''': `' || fxs:detail(xs:annotation/xs:documentation) || '`')"/>
    <xsl:sequence select="
      '        ''' || $name || ''': { base: [''' || $simpleType/xs:restriction/@base || '''], enum: [' ||
      string-join(fxs:enumerations($simpleType) ! ('''' || . || ''''), ', ') || ']' ||
      (if (exists($documented)) then ', detail: { ' || string-join($documented, ', ') || ' }' else '') || ' },&#xa;'"/>
  </xsl:function>

  <!-- documentation as the text of a template literal: lines joined into paragraphs -->
  <xsl:function name="fxs:detail" as="xs:string">
    <xsl:param name="documentation" as="element(xs:documentation)"/>
    <xsl:variable name="escaped" select="replace(replace(replace(string($documentation), '\\', '\\\\'), '`', '\\`'), '\$\{', '\\\${')"/>
    <xsl:sequence select="normalize-space($escaped)"/>
  </xsl:function>

</xsl:stylesheet>
