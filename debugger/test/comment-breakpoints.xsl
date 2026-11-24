<?xml version="1.0" encoding="UTF-8"?>
<!--
  header notes
-->
<xsl:stylesheet version="4.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="xml"/>
  <!-- before the global variable -->
  <xsl:variable name="g" select="1"/>

  <xsl:template match="/">
    <!--
      before an instruction
    -->
    <r>
      <xsl:value-of select="$g"/>
      <!-- at the end of r: <xsl:if test="x"> -->
    </r>
    <xsl:text><![CDATA[
<!-- not a comment
]]></xsl:text>
    <!-- last in the template -->
  </xsl:template>

  <xsl:note>
    <!-- in a note -->
    <xsl:sequence select="1"/>
  </xsl:note>

  <xsl:template name="other">
    <xsl:sequence select="2"/>
  </xsl:template>
</xsl:stylesheet>
