<xsl:stylesheet version="4.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" exclude-result-prefixes="#all">
  <xsl:note>A top-level note,
    over two lines.</xsl:note>
  <xsl:template name="xsl:initial-template">
    <xsl:note>
      <p>An instruction-level note,</p>
      <xsl:value-of select="
        'never evaluated'"/>
      <xsl:message select="'never written'"/>
    </xsl:note>
    <out>
      <xsl:value-of select="1"/>
    </out>
  </xsl:template>
</xsl:stylesheet>
