<xsl:stylesheet version="4.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:output method="xml"/>
  <data-element/>

  <!-- a comment -->
  <xsl:template match="item">
    <xsl:variable name="multi" select="
      f:a(
        @n
      )"/>
    <xsl:if test="$multi gt 0">
      <r n="{$multi}"
         a="b">text</r>
    </xsl:if>
    <xsl:note>
      <xsl:value-of select="'in a note'"/>
    </xsl:note>
    <xsl:choose>
      <xsl:when test="@n = 1">
        <one/>
      </xsl:when>
      <xsl:otherwise>
        <other/>
      </xsl:otherwise>
    </xsl:choose>
    <xsl:apply-templates select="*">
      <xsl:sort select="@n"/>
    </xsl:apply-templates>
  </xsl:template>

  <xsl:function name="f:a">
    <xsl:param name="x"/>
    <xsl:sequence select="$x"/>
  </xsl:function>
</xsl:stylesheet>
