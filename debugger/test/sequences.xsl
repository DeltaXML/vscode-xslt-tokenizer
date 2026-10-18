<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="v" select="(1, 2)"/>
    <xsl:sequence select="for $x in $v return $x * 10"/>
    <xsl:sequence select="let $y := 3 return $y"/>
    <xsl:sequence select="some $x in $v satisfies $x = 2"/>
    <xsl:sequence select="if ($v = 1) then 'a' else 'b'"/>
    <xsl:sequence select="$v ! (. + 1)"/>
    <xsl:sequence select="count($v)"/>
    <xsl:sequence select="$v[1] + 5"/>
    <xsl:sequence select="f:twice(4)"/>
    <xsl:sequence select="'literal'"/>
    <xsl:sequence select="$v"/>
    <xsl:variable name="w1" select="for $x in $v return $x * 10"/>
    <xsl:variable name="w2" select="let $y := 3 return $y"/>
    <xsl:variable name="w3" select="if ($v = 1) then 'a' else 'b'"/>
    <xsl:sequence select="($w1, $w2, $w3)"/>
    <xsl:sequence select="
      for $x in $v
      return $x * 100"/>
    <xsl:sequence select="
      count(
        $v)"/>
    <xsl:if test="current-date() gt xs:date('2000-01-01')" xmlns:xs="http://www.w3.org/2001/XMLSchema">
      <xsl:sequence select="$v[1] + 5"/>
    </xsl:if>
    <xsl:for-each select="$v">
      <xsl:sequence select=". * 3"/>
    </xsl:for-each>
    <xsl:value-of select="for $x in $v return $x"/>
    <xsl:copy-of select="for $x in $v return $x"/>
  </xsl:template>
  <xsl:function name="f:twice"><xsl:param name="x"/><xsl:sequence select="$x * 2"/></xsl:function>
</xsl:stylesheet>
