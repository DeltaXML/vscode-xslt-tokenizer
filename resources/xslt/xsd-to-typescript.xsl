<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:fxs="com.deltaxml.schema.functions"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
  
  <xsl:output method="text" indent="yes"/>
  <xsl:mode on-no-match="shallow-copy"/>
  <xsl:strip-space elements="*"/>
  
  <xsl:template match="/*" mode="#all">
    <xsl:call-template name="typeScriptHeader"/>
    <xsl:text>export class DCPSchema implements SchemaData {{
  docType = DocumentTypes.DCP;
  </xsl:text>
    <xsl:call-template name="addSimpleType"/>
    <xsl:call-template name="addComplexType"/>
    <xsl:call-template name="addElement"/>
    <xsl:call-template name="addAttributeGroup"/>
    <xsl:text>}}
</xsl:text>
  </xsl:template>
  
  <xsl:template match="xs:annotation"/>
  
  <xsl:template name="addSimpleType">
    <xsl:text>simpleTypes: {{ [name: string]: SimpleType }} = {{</xsl:text>
    <xsl:apply-templates select="xs:simpleType"/>
    <xsl:text>}}
</xsl:text>
  </xsl:template>
  
  <xsl:template name="addComplexType">
    <xsl:text>complexTypes: {{ [name: string]: ComplexType }} = {{</xsl:text>
    <xsl:apply-templates select="xs:complexType"/>
    <xsl:text>}}
</xsl:text>
  </xsl:template>
  
  <xsl:template name="addElement">
    <xsl:text>elements: {{ [name: string]: ComplexType }} = {{</xsl:text>
    <xsl:apply-templates select=".//xs:element[@name]"/>
    <xsl:text>}}
</xsl:text>
  </xsl:template>
  
  <xsl:template name="addAttributeGroup">
    <xsl:text>attributeGroups: {{ [name: string]: any }} = {{</xsl:text>
    <xsl:apply-templates select="xs:attributeGroup"/>
    <xsl:text>}}
</xsl:text>
  </xsl:template>
  
  <xsl:template match="xs:attributeGroup">
    <xsl:variable name="joined" as="xs:string" select="fxs:createAttrProperties(.)"/>  
    <xsl:text>"{@name}": {{{$joined}}},
</xsl:text>
  </xsl:template>
  
  <xsl:function name="fxs:createAttrProperties" as="xs:string?">
    <xsl:param name="context" as="element()"/>
    <xsl:for-each select="$context">
      <xsl:variable name="attrList" as="xs:string*">
        <xsl:sequence select="for $a in .//xs:attribute return concat('''', $a/@name, '''', ': ', '''', $a/@type, '''')"/>           
      </xsl:variable>
      <xsl:variable name="attrValue" as="xs:string?" 
        select="
          if (count($attrList) gt 0) then 
            '&#xa;attrs: {&#xa;' || string-join($attrList, ',&#xa;') || '&#xa;}'
          else ()"/>
      <xsl:sequence select="$attrValue"/>
    </xsl:for-each>
  </xsl:function>
  
  <xsl:template match="xs:complexType|xs:element">
    <xsl:variable name="base" as="xs:string*" 
      select="
        if ((.//xs:restriction| .//xs:extension)/@base) then
          '&#xa;base: [' ||  string-join(for $a in (.//xs:restriction|.//xs:extension)/@base => distinct-values() return concat('''', $a, ''''), ',') || ']'
        else ()"/>
    <xsl:variable name="detail" as="xs:string?" select="if (self::xs:element) then fxs:getAnyDetail(.) else ()"/>
    <xsl:variable name="detailProperty" as="xs:string?" select="if (exists($detail)) then '&#xa;detail: `' || $detail || '`' else ()"/>
    
    <xsl:variable name="elementType" as="xs:string?" select="if (exists(@type)) then '&#xa;type: ''' || @type || '''' else ()"/>

    <xsl:variable name="attrValue" as="xs:string?" select="fxs:createAttrProperties(.)"/>
    <xsl:variable name="elementArray" as="xs:string?">
      <xsl:variable name="processContentsLax" as="xs:string?" 
        select="if (exists(.//xs:any[@processContents eq 'lax'])) then 'xs:lax' else ()"/>
      <xsl:variable name="elementNames" as="xs:string*" select=".//xs:element/(@name|@ref), $processContentsLax"/>     
      <xsl:if test="count($elementNames) gt 0">
        <xsl:variable name="elementNameString" select="string-join((for $a in $elementNames return '''' || $a || ''''), ',')"/>
        <xsl:sequence select="'&#xa;elementNames: [' || $elementNameString || ']'"/>
      </xsl:if>
    </xsl:variable>
      
    <xsl:variable name="joined" as="xs:string" select="string-join(($elementType, $base, $attrValue, $elementArray, $detailProperty), ', ')"/>
    
    <xsl:text>"{@name}": {{{$joined}}},
</xsl:text>   
  </xsl:template>
  
  <xsl:template match="xs:simpleType">
    <xsl:variable name="base" as="xs:string*" 
      select="
        if ((.//xs:restriction| .//xs:extension)/@base) then
          'base: [' ||  string-join(for $a in (.//xs:restriction|.//xs:extension)/@base => distinct-values() return concat('''', $a, ''''), ',') || ']'
        else ()"/>
    <xsl:variable name="enumList" as="xs:string*">
      <xsl:apply-templates mode="#current" select=".//(xs:restriction|xs:extension)[xs:enumeration]"/>
    </xsl:variable>
    <xsl:variable name="enumValue" as="xs:string?" 
      select="
        if (count($enumList) gt 0) then 
          'enum: [' || string-join($enumList, ', ') || ']'
        else ()"/>
    
    <xsl:variable name="list" as="xs:string*" select="if (.//xs:list/@itemType) then 'list: ''' || .//xs:list/@itemType || '''' else ()"/>
    
    <xsl:variable name="joined" as="xs:string" select="string-join(($base, $list, $enumValue), ',&#xa;')"/>          
    <xsl:text>"{@name}": {{{$joined}}},
</xsl:text> 
  </xsl:template>
  
  <xsl:template match="(xs:restriction|xs:extension)[xs:enumeration]" mode="#default">
    <xsl:variable name="enums" as="xs:string*" select="xs:enumeration/@value!concat('''', ., '''')"/> 
    <xsl:sequence select="string-join($enums, ',')"/> 
  </xsl:template>
  
  <xsl:template match="(xs:restriction|xs:extension)[xs:attribute]" mode="#default">
    <xsl:variable name="enums" as="xs:string*" select="xs:attribute/@name!concat('''', ., '''')"/> 
    <xsl:sequence select="string-join($enums, ',')"/> 
  </xsl:template>
  
  <xsl:template name="typeScriptHeader" as="xs:string">
    <xsl:text expand-text="no">
/**
 *  Copyright (c) 2020 DeltaXML Ltd. and others.
 *  All rights reserved. This program and the accompanying materials
 *  are made available under the terms of the MIT license
 *  which accompanies this distribution.
 *
 *  Contributors:
 *  DeltaXML Ltd.
 */

 /*
  NOTE: this code was auto-generated using .resources/xsd-to-typescript
  to transform core-dcp-v1_0.xsd - included in XML Compare
 */
 
import { SchemaData } from './xsltSchema'
import { DocumentTypes } from './xslLexer';

export interface SimpleType {
    base?: string[],
    enum?: string[],
    list?: string,
    detail?: string
}

export interface ComplexType {
    attrs?: any,
    base?: string,
    type?: string,
    elementNames?: string[],
    attributeList?: AttributeItem[];
    primitive?: string,
    detail?: string
}

export interface SubstitutionGroupType {
    type: string,
    elements: { [name: string]: ComplexType}
}

export interface AttributeItem {
    name: string,
    enum?: string[];
}
    </xsl:text>  
  </xsl:template>
  
  <xsl:function name="fxs:getAnyDetail" as="xs:string?">
    <xsl:param name="element" as="element()"/>
    <xsl:variable name="ESCLF" as="xs:string" select="'XLFX'"/>
    <xsl:variable name="docElement" as="element()" select="$element/xs:annotation/xs:documentation"/>
    <xsl:choose>
      <xsl:when test="empty($docElement)"/>
      <xsl:otherwise>
        <xsl:variable name="escaped" select="replace($docElement, '\$', '\\\$')"/>
        <xsl:variable name="reservedLF" as="xs:string" select="replace($escaped,'\r?\n', $ESCLF)"/>
        <xsl:variable name="normalised" as="xs:string" select="normalize-space($reservedLF)"/>
        <xsl:sequence select="replace($normalised, $ESCLF, '&#xa;') "/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>
  
  
</xsl:stylesheet>