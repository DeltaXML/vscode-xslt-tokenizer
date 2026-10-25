<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
    exclude-result-prefixes="#all">
  <xsl:key name="by-parity" match="item" use="
    if (xs:integer(@n) mod 2 eq 0)
    then 'even'
    else 'odd'"/>
  <xsl:template match="/">
    <out>
      <odd><xsl:value-of select="key('by-parity', 'odd')/@n"/></odd>
      <even><xsl:value-of select="key('by-parity', 'even')/@n"/></even>
    </out>
  </xsl:template>
</xsl:stylesheet>
