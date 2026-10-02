<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:ex="urn:example:shapes"
                version="4.0">

  <xsl:note format="xdoc-md">
    Colours for the shapes demo.
  </xsl:note>

  <xsl:function name="ex:colour" as="xs:string?">
    <xsl:note format="xdoc-md">
      Returns the hex code of a named colour.

      @param $name the colour's name, e.g. `red`
    </xsl:note>
    <xsl:param name="name" as="xs:string"/>
    <xsl:sequence select="{ 'red': '#d33', 'blue': '#36c' }($name)"/>
  </xsl:function>

</xsl:stylesheet>
