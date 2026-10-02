<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:ex="urn:example:shapes"
                version="4.0">

  <xsl:import href="units.xsl"/>

  <xsl:note format="xdoc-md">
    Geometry functions for the shapes demo.
  </xsl:note>

  <xsl:function name="ex:perimeter" as="xs:double">
    <xsl:note format="xdoc-md">
      Returns the perimeter of a rectangle.

      @param $width the width, in `cm`
      @param $height the height, in `cm`
    </xsl:note>
    <xsl:param name="width" as="xs:double"/>
    <xsl:param name="height" as="xs:double"/>
    <xsl:sequence select="2 * ($width + $height)"/>
  </xsl:function>

</xsl:stylesheet>
