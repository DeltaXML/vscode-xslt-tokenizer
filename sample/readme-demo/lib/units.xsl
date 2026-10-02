<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:ex="urn:example:shapes"
                version="4.0">

  <xsl:note format="xdoc-md">
    Unit conversions for the shapes demo.
  </xsl:note>

  <xsl:function name="ex:inches" as="xs:double">
    <xsl:note format="xdoc-md">
      Converts a length in centimetres to inches.

      @param $cm the length, in `cm`
    </xsl:note>
    <xsl:param name="cm" as="xs:double"/>
    <xsl:sequence select="$cm div 2.54"/>
  </xsl:function>

</xsl:stylesheet>
