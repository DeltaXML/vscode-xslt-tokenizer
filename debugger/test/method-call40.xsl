<xsl:stylesheet version="4.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:function name="f:double"><xsl:param name="this"/><xsl:message select="'double ' || $this?v"/><xsl:sequence select="$this?v * 2"/></xsl:function>
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="obj" select="{'v': 3, 'double': f:double#1}"/>
    <xsl:variable name="call" select="
      $obj
      =?> double()"/>
    <xsl:variable name="end" select="1"/>
    <out call="{$call}"/>
  </xsl:template>
</xsl:stylesheet>
