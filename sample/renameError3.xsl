<?xml version="1.0" encoding="UTF-8"?>


<!-- 
     * This is a stylesheet for converting XML to JSON. 
     * It expects the XML to be in the format produced by the XSLT 3.0 function
     * fn:json-to-xml(), but is designed to be highly customizable.
     *
     * The stylesheet is made available under the terms of the W3C software notice and license
     * at http://www.w3.org/Consortium/Legal/copyright-software-19980720
     *
-->    

<xsl:package
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:map="http://www.w3.org/2005/xpath-functions/map"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:fn="http://www.w3.org/2005/xpath-functions"
    xmlns:j="http://www.w3.org/2013/XSLT/xml-to-json"
    exclude-result-prefixes="xs fn j" default-mode="j:xml-to-json" version="3.0">
    
    <!-- Entry point: function to convert a supplied XML node to a JSON string, supplying options -->
    <xsl:function name="j:xml-to-json" as="xs:string" visibility="public">

        <xsl:variable name="input" as="node()" use-when="$VALIDATE">
            <xsl:copy-of select="$input" validation="strict"/>
        </xsl:variable>

    </xsl:function>
    
    
    <xsl:template match="/" mode="indent no-indent">
        <xsl:apply-templates mode="#current"/>
    </xsl:template>
    
</xsl:package>