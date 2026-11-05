<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:function name="f:check"><xsl:param name="x"/><xsl:message select="'check ' || $x"/><xsl:sequence select="number($x) gt 1"/></xsl:function>
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="doc"><i>1</i><i>2</i><i>3</i><i>4</i></xsl:variable>
    <out>
      <xsl:if test="
        $doc/i[f:check(.)]">if</xsl:if>
      <xsl:choose>
        <xsl:when test="
          $doc/i[f:check(. * 10)]">when</xsl:when>
      </xsl:choose>
    </out>
  </xsl:template>
</xsl:stylesheet>
