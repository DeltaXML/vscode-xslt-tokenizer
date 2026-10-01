<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:ex="urn:example:shapes"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="4.0">

  <xsl:import href="lib/geometry.xsl"/>
  <xsl:include href="lib/colours.xsl"/>

  <xsl:function name="ex:area" as="xs:double">
    <xsl:note format="xdoc-md">
      Returns the area of a rectangle, **scaled** by an optional factor.

      @param $width the width, in `cm`
      @param $height the height, in `cm`
      @param $scale the scale factor - `1` by default
      @return the area, in square centimetres
      @see ex:perimeter#2
    </xsl:note>

    
    <xsl:param name="width" as="xs:double"/>
    <xsl:param name="height" as="xs:double"/>
    <xsl:param name="scale" as="xs:double" required="no" select="1"/>
    <xsl:sequence select="$width * $height * $scale"/>
  </xsl:function>

  <xsl:template name="xsl:initial-template">
    <xsl:variable name="width" as="xs:double" select="5"/>
    <xsl:variable name="height" as="xs:double" select="22"/>
    <shape colour="{ex:colour('red')}" perimeter="{ex:perimeter($width, $height)}">
      <area>{ex:area($width, $height, scale := 0.5)}</area>
    </shape>
  </xsl:template>

</xsl:stylesheet>
