<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" xmlns:xs="http://www.w3.org/2001/XMLSchema" exclude-result-prefixes="#all">
  <xsl:param name="n" as="xs:integer" select="100000"/>
  <xsl:function name="f:sum" as="xs:integer">
    <xsl:param name="i" as="xs:integer"/>
    <xsl:param name="acc" as="xs:integer"/>
    <xsl:sequence select="if ($i eq 0) then $acc else f:sum($i - 1, $acc + $i)"/>
  </xsl:function>
  <xsl:template name="count">
    <xsl:param name="i" as="xs:integer"/>
    <xsl:choose>
      <xsl:when test="$i eq 0"><done/></xsl:when>
      <xsl:otherwise>
        <xsl:call-template name="count"><xsl:with-param name="i" select="$i - 1"/></xsl:call-template>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>
  <xsl:template name="xsl:initial-template">
    <out sum="{f:sum($n, 0)}"><xsl:call-template name="count"><xsl:with-param name="i" select="$n"/></xsl:call-template></out>
  </xsl:template>
</xsl:stylesheet>
