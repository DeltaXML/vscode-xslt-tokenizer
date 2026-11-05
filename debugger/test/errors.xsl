<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:err="http://www.w3.org/2005/xqt-errors"
    xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="input" select="'abc'"/>
    <xsl:try>
      <xsl:sequence select="f:fail(1)"/>
      <xsl:catch><caught code="{$err:code}"/></xsl:catch>
    </xsl:try>
    <after-try/>
    <out><xsl:value-of select="xs:decimal($input)"/></out>
  </xsl:template>
  <xsl:function name="f:fail">
    <xsl:param name="n"/>
    <xsl:sequence select="$n idiv 0"/>
  </xsl:function>
</xsl:stylesheet>
