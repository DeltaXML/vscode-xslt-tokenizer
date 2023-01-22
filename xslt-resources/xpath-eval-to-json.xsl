<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:ext="com.functions.ext"
                xmlns="http://www.w3.org/2005/xpath-functions"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
  
  <xsl:output method="text" indent="no"/>
  <xsl:mode on-no-match="shallow-copy"/>
  
  <xsl:param name="expression" as="xs:string"/>
  <xsl:param name="sourceURI" as="xs:string?"/>
  <xsl:param name="this" as="item()"/>
  
  <xsl:variable name="source.xml" static="yes" as="xs:integer" select="1"/>
  <xsl:variable name="source.empty" static="yes" as="xs:integer" select="2"/>
  <xsl:variable name="source.json" static="yes" as="xs:integer" select="3"/>
  <xsl:variable name="emptyArrayXML" as="element()"><array/></xsl:variable>
  
  <xsl:variable name="percentCP" as="xs:integer" select="string-to-codepoints('%')[1]"/>
  <xsl:variable name="singleQuoteCP" as="xs:integer" select="string-to-codepoints('''')[1]"/>
  <xsl:variable name="doubleQuoteCP" as="xs:integer" select="string-to-codepoints('&quot;')[1]"/>
  
  <xsl:param name="xpathVariableNamesText" as="xs:string" select="''"/>
  <xsl:param name="xpathVariableExpressionsText" as="xs:string" select="''"/>
  <xsl:param name="staticBaseURI" as="xs:string" select="''"/>
  
  <xsl:variable name="xpathVariableMap" as="map(*)">
    <xsl:variable name="xpathVariableNames" as="xs:string" select="tokenize($xpathVariableNamesText, ',')"/>
    <xsl:variable name="xpathVariableExpressions" as="xs:string" select="tokenize($xpathVariableExpressionsText, '`')"/>
    <xsl:map>
      <xsl:sequence select="for-each-pair($xpathVariableNames, $xpathVariableExpressions, function($k, $v) {map { QName('', $k): $v }})"/>
    </xsl:map>
  </xsl:variable>
  
  <xsl:variable name="testedSourceURIParts" as="item()*" select="ext:testSourceURI()"/>
  <xsl:variable name="sourceType" as="xs:integer" select="$testedSourceURIParts[1]"/>
  <xsl:variable name="sourceDoc" as="item()*" select="$testedSourceURIParts[2]"/>
  
  <xsl:variable name="contextNsDoc" as="element()" select="ext:createContextElement()"/>
  <xsl:variable name="xmlnsMap" as="map(*)" 
    select="if ($sourceType eq $source.xml) then ext:getURItoPrefixMap($sourceDoc/*) else map {}"/>
  
  <xsl:variable name="nsContextElement" as="element()">
    <root xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
          xmlns:xs="http://www.w3.org/2001/XMLSchema"
          xmlns:array="http://www.w3.org/2005/xpath-functions/array"
          xmlns:map="http://www.w3.org/2005/xpath-functions/map"
          xmlns:math="http://www.w3.org/2005/xpath-functions/math"
      />
  </xsl:variable>
  
  <xsl:function name="ext:testSourceURI" as="item()*">
    <xsl:choose>
      <xsl:when test="$sourceURI and $sourceURI ne 'undefined'">
        <xsl:try>
          <xsl:sequence select="$source.xml, doc($sourceURI)"/>
          <xsl:catch>
            <xsl:try>
              <xsl:sequence select="$source.json, json-doc($sourceURI)"/>
              <xsl:catch select="$source.empty, ()"/>
            </xsl:try>
          </xsl:catch>
        </xsl:try>
      </xsl:when>
      <xsl:otherwise>
        <xsl:sequence select="$source.empty, ()"/>
      </xsl:otherwise>
    </xsl:choose>   
  </xsl:function>
  
  <xsl:function name="ext:createContextElement" as="element()">
    <xsl:choose>
      <xsl:when test="$sourceType eq $source.xml">
        <xsl:copy select="$sourceDoc/*" copy-namespaces="yes">
          <xsl:namespace name="array" select="'http://www.w3.org/2005/xpath-functions/array'"/>
          <xsl:namespace name="map" select="'http://www.w3.org/2005/xpath-functions/map'"/>
          <xsl:namespace name="math" select="'http://www.w3.org/2005/xpath-functions/math'"/>
          <xsl:namespace name="xs" select="'http://www.w3.org/2001/XMLSchema'"/>
        </xsl:copy>
      </xsl:when>
      <xsl:otherwise>
        <xsl:sequence select="$nsContextElement"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>
  
  <xsl:template name="main">
    <xsl:variable name="expressionParts" as="xs:string*" select="ext:extractPreamble($expression)"/>
    <xsl:variable name="preamble" as="xs:string" select="$expressionParts[1]"/>
    <xsl:variable name="preambleParts" as="xs:string*" select="tokenize($preamble, '\s*=\s*')"/>
    <xsl:variable name="assignVarName" as="xs:string?" select="if (count($preambleParts) eq 2 and $preambleParts[1] eq 'variable') then $preambleParts[2] else ()"/>
    <xsl:variable name="cleanedExpression" as="xs:string" select="$expressionParts[2]"/>
    <xsl:variable name="result" as="item()*" select="ext:evaluate($sourceDoc, $cleanedExpression)"/>
    
    <xsl:variable name="jsonXML" select="if (exists($result)) then ext:convertArrayEntry($result) else $emptyArrayXML"/>
    <xsl:sequence select="xml-to-json($jsonXML)"/>
  </xsl:template>
  
  <xsl:function name="ext:evaluate" as="item()*">
    <xsl:param name="doc" as="item()*"/>
    <xsl:param name="xpathText" as="xs:string"/>
    
    <xsl:choose>
      <xsl:when test="$sourceType eq $source.xml">
        <xsl:evaluate 
          xpath="$xpathText"
          context-item="$doc"
          namespace-context="$contextNsDoc"
          with-params="$xpathVariableMap"
          base-uri="{$staticBaseURI}"
          />
      </xsl:when>
      <xsl:otherwise>
        <xsl:evaluate 
          xpath="$xpathText"
          context-item="$doc"
          with-params="$xpathVariableMap"
          base-uri="{$staticBaseURI}"
          />
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>
  
  <xsl:function name="ext:getURItoPrefixMap" as="map(*)">
    <xsl:param name="source" as="node()"/>
    <xsl:sequence 
      select="
        map:merge(
          for $pfx in in-scope-prefixes($source),
            $ns in namespace-uri-for-prefix($pfx, $source)
          return 
            map:entry($ns, $pfx)
        )"/>
  </xsl:function>
  
  <xsl:function name="ext:extractPreamble" as="xs:string*">
    <xsl:param name="text" as="xs:string"/>
    <xsl:variable name="codepoints" as="xs:integer*" select="string-to-codepoints($text)"/>
    <xsl:variable name="percentPos" as="xs:integer?" select="index-of($codepoints, $percentCP)[1]"/>
    <xsl:variable name="singlePos" as="xs:integer?" select="index-of($codepoints, $singleQuoteCP)[1]"/>
    <xsl:variable name="doublePos" as="xs:integer?" select="index-of($codepoints, $doubleQuoteCP)[1]"/>
    
    <xsl:variable name="resolvedPos" as="xs:integer?" >
      <xsl:if test="exists($percentPos)">
        <xsl:variable name="minPos" as="xs:integer" select="min(($percentPos, $singlePos, $doublePos))"/>
        <xsl:sequence select="if ($percentPos eq $minPos) then $percentPos else ()"/>
      </xsl:if>
    </xsl:variable>
    <xsl:variable name="preamble" as="xs:string" select="if ($resolvedPos) then substring($text, 1, $resolvedPos - 1) => normalize-space() else ''"/>
    <xsl:variable name="main" as="xs:string" select="if ($resolvedPos) then substring($text, $resolvedPos + 1) else $text"/>
    <xsl:sequence select="$preamble, $main"/>
  </xsl:function>
  
  <xsl:variable name="regex" as="xs:string" select="'Q\{[^\{]*\}'"/>
  
  <xsl:function name="ext:tidyXPath" as="xs:string*">
    <xsl:param name="node" as="node()"/>
    <xsl:variable name="parts" as="xs:string*">
      <xsl:analyze-string select="path($node)" regex="{$regex}">
        <xsl:matching-substring>
          <xsl:variable name="uri" as="xs:string" select="substring(., 3, string-length(.) - 3)"/>
          <xsl:variable name="pfx" select="map:get($xmlnsMap, $uri)"/>
          <xsl:sequence select="if (string-length($pfx) eq 0) then '' else $pfx || ':'"/>
        </xsl:matching-substring>
        <xsl:non-matching-substring>
          <xsl:sequence select="."/>
        </xsl:non-matching-substring>
      </xsl:analyze-string>
    </xsl:variable>
    <xsl:sequence select="'&#x1680;' || string-join($parts)"/>
  </xsl:function>
  
  <xsl:function name="ext:convertMapEntry">
    <xsl:param name="key" as="xs:string?"/>
    <xsl:param name="value" as="item()*"/>
    
    <xsl:choose>
      <xsl:when test="count($value) gt 1">
        <array>
          <xsl:if test="$key">
            <xsl:attribute name="key" select="$key"/>
          </xsl:if>
          <xsl:for-each select="$value">
            <xsl:apply-templates select="."/>
          </xsl:for-each>
        </array>
      </xsl:when>
      <xsl:when test="exists($value)">
        <xsl:for-each select="$value">
          <xsl:apply-templates select=".">
            <xsl:with-param name="key" select="$key"/>
          </xsl:apply-templates>
        </xsl:for-each>
      </xsl:when>
      <xsl:otherwise>
        <array key="{$key}"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>
  
  <xsl:function name="ext:convertArrayEntry">
    <xsl:param name="value" as="item()*"/>
    <xsl:choose>
      <xsl:when test="count($value) gt 1">
        <array>
          <xsl:for-each select="$value">
            <xsl:apply-templates select="."/>
          </xsl:for-each>
        </array>
      </xsl:when>
      <xsl:when test="exists($value)">
        <xsl:for-each select="$value">
          <xsl:apply-templates select="."/>
        </xsl:for-each>
      </xsl:when>
      <xsl:otherwise>
        <array/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:function>
  
  <xsl:template match=".[
      . instance of node() 
      or . instance of text()
      or . instance of attribute()
      or . instance of processing-instruction()
      or . instance of comment()
    ]" mode="#default">
    <xsl:param name="key" as="xs:string?"/>
    <string>
      <xsl:if test="$key">
        <xsl:attribute name="key" select="$key"/>
      </xsl:if>
      <xsl:sequence select="ext:tidyXPath(.)"/>
    </string>
  </xsl:template>
  
  <xsl:template match=".[. instance of map(*)]" mode="#default">
    <xsl:param name="key" as="xs:string?"/>
    <map>
      <xsl:if test="$key">
        <xsl:attribute name="key" select="$key"/>
      </xsl:if>
      <xsl:sequence select="map:for-each(., ext:convertMapEntry#2)"/>
    </map>
  </xsl:template>
  
  <xsl:template match=".[. instance of array(*)]" mode="#default">
    <xsl:param name="key" as="xs:string?"/>
    <array>
      <xsl:if test="$key">
        <xsl:attribute name="key" select="$key"/>
      </xsl:if>
      <xsl:sequence select="array:for-each(., ext:convertArrayEntry#1)"/>
    </array>
  </xsl:template>
  
  <xsl:template match="." mode="#default">   
    <xsl:param name="key" as="xs:string?"/>
    
    <xsl:variable name="jsonTypeName" as="xs:string"
      select="
        if (. instance of xs:numeric)
          then 'number'
        else if (. instance of xs:boolean)
          then 'boolean'
        else 'string'
      "/>
    
    <xsl:element name="{$jsonTypeName}">
      <xsl:if test="$key">
        <xsl:attribute name="key" select="$key"/>
      </xsl:if>
      <xsl:value-of select="."/>
    </xsl:element>
    
  </xsl:template> 
  
</xsl:stylesheet>