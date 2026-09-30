<?xml version="1.0" encoding="UTF-8"?>
<!-- A string library, imported as http://example.com/xslt/strings.xsl -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:str="http://example.com/ns/strings"
                exclude-result-prefixes="#all"
                version="3.0">

  <!-- the text, upper-cased, with an exclamation mark -->
  <xsl:function name="str:shout" as="xs:string">
    <xsl:param name="text" as="xs:string"/>
    <xsl:sequence select="upper-case($text) || '!'"/>
  </xsl:function>

  <xsl:variable name="str:separator" as="xs:string" select="' | '"/>

</xsl:stylesheet>
