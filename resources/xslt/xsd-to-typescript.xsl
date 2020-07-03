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
    <xsl:apply-templates select="xs:element"/>
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
    <xsl:variable name="elementType" as="xs:string?" select="if (exists(@type)) then 'type: ''' || @type || '''' else ()"/>

    <xsl:variable name="attrValue" as="xs:string?" select="fxs:createAttrProperties(.)"/>
    <xsl:variable name="elementArray" as="xs:string?">
      <xsl:variable name="processContentsLax" as="xs:string?" 
        select="if (exists(.//xs:any[@processContents eq 'lax'])) then 'xs:lax' else ()"/>
      <xsl:variable name="elementNames" as="xs:string*" select=".//xs:element/(@name|@ref), $processContentsLax"/>     
      <xsl:if test="count($elementNames) gt 0">
        <xsl:variable name="elementNameString" select="string-join((for $a in $elementNames return '''' || $a || ''''), ',')"/>
        <xsl:sequence select="'elementNames: [' || $elementNameString || ']'"/>
      </xsl:if>
    </xsl:variable>
      
    <xsl:variable name="joined" as="xs:string" select="string-join(($elementType, $base, $attrValue, $elementArray), ', ')"/>
    
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
import { SchemaData } from './xsltSchema'

export interface SimpleType {
    base?: string[],
    enum?: string[],
    list?: string,
}

export interface ComplexType {
    attrs?: any,
    base?: string,
    type?: string,
    elementNames?: string[],
    attributeList?: AttributeItem[];
    primitive?: string
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
  
  
</xsl:stylesheet>