<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xpath-default-namespace="urn:x" exclude-result-prefixes="#all">
  <xsl:decimal-format name="f" decimal-separator="," grouping-separator="."/>
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="doc">
      <r xmlns="urn:x"><a>1.5</a><a>2</a></r>
    </xsl:variable>
    <xsl:variable name="formatted" select="
      $doc/r/a
      ! format-number(number(.), '0,0', 'f')"/>
    <out><xsl:value-of select="$formatted"/></out>
  </xsl:template>
</xsl:stylesheet>
