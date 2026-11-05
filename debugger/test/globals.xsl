<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:variable name="c" select="count(//item)"/>
  <xsl:variable name="b" select="$c gt 1 and $c lt 10"/>
  <xsl:variable name="a">
    <xsl:sequence select="string(//item[1]/@n)"/>
  </xsl:variable>
  <xsl:variable name="d" select="$a || '!'"/>
  <xsl:variable name="e" select="f:a()"/>
  <xsl:function name="f:a"><xsl:sequence select="$a"/></xsl:function>
  <xsl:template match="/">
    <out c="{$c}" a="{$a}" b="{$b}" d="{$d}" e="{$e}"/>
  </xsl:template>
</xsl:stylesheet>
