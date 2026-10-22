<xsl:stylesheet version="4.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:function name="f:t"><xsl:param name="x"/><xsl:message select="'t ' || $x"/><xsl:sequence select="$x"/></xsl:function>
  <xsl:template name="xsl:initial-template">
    <out>
      <xsl:for-each select="2, 9">
        <xsl:variable name="n" select="."/>
        <xsl:choose>
          <xsl:when test="$n = 1" select="
            f:t('one')"/>
          <xsl:when test="$n = 2" select="
            f:t('two')"/>
          <xsl:otherwise select="
            f:t('other')"/>
        </xsl:choose>
        <xsl:if test="$n gt 5" then="
          f:t('big')" else="
          f:t('small')"/>
      </xsl:for-each>
      <xsl:for-each select="1 to 3" separator=", ">
        <xsl:value-of select="."/>
      </xsl:for-each>
      <xsl:variable name="d"><a/><b/></xsl:variable>
      <xsl:apply-templates select="$d/*" separator="|"/>
      <end/>
    </out>
  </xsl:template>
  <xsl:template match="*">
    <xsl:value-of select="name()"/>
  </xsl:template>
</xsl:stylesheet>
