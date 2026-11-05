<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema" exclude-result-prefixes="#all">
  <xsl:template match="/">
    <out>
      <xsl:variable name="factor" select="count(items/item)"/>
      <sum><xsl:sequence select="fold-left(items/item, 0,
        function($sum, $item) {
          $sum + xs:integer($item/@n)
        })"/></sum>
      <scaled><xsl:sequence select="for-each(items/item,
        function($item) {
          xs:integer($item/@n) * $factor
        })"/></scaled>
    </out>
  </xsl:template>
</xsl:stylesheet>
