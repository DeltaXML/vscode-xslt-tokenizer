<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema" exclude-result-prefixes="#all">
  <xsl:template match="/">
    <xsl:variable name="factor" select="count(items/item)"/>
    <out><xsl:sequence select="fold-left(items/item, (),
      function($totals, $item) {
        let $last := $totals[last()] return
          if (xs:integer($item/@n) gt 1)
          then ($totals, max(($last, xs:integer($item/@n) * $factor)) + $last)
          else ($totals, xs:integer($item/@n))
      })"/></out>
  </xsl:template>
</xsl:stylesheet>
