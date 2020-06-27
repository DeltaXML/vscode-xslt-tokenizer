<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:word-by-word="com.deltaxml/generate/features/word-by-word"
                xmlns:wfn="com.deltaxml/generate/functions/word-by-word"
                xmlns:deltaxml="http://www.deltaxml.com/ns/well-formed-delta-v1"
                xmlns:dxa="deltxml.com"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    
    <book>
        test
        <newer>
            <deeper>
                also
            </deeper>
        </newer>
    </book>
    
    <xsl:function name="wfn:createAttrNameMap" as="map(xs:string, attribute()?)">
        <xsl:variable name="test" as="xs:string" select="?*"/>
        <xsl:param name="element" as="element()"/>
        <xsl:variable name="wbw-attrs" as="attribute()*" select="$element/@word-by-word:*"/>
        <xsl:variable name="instructionAttrs" as="attribute()*" select="$wbw-attrs[substring-before(local-name(.), '_') = $splitterNames]"/>
        <xsl:variable name="attrNames" as="map(xs:string, attribute()?)" select="
            map:merge(
                for $attr in $wbw-attrs return
                               
                    let $attrName := local-name($attr),
                        $attrNameParts := tokenize($attrName, '_'),
                        $splitType := $attrNameParts[1]                   
                    return
                        if ($splitType = $splitterNames) then
                            ()
                        else
                            let $pos := $attrNameParts[2],
                                $instuction := $instructionAttrs[local-name() => ends-with($pos)] return
                                map:entry(string($attr), $instuction)
            )"/>
        <xsl:sequence select="$attrNames"/>        
    </xsl:function>
    
</xsl:stylesheet>