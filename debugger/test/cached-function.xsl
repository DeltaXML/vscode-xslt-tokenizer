<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:function name="f:square" as="xs:integer" cache="yes">
    <xsl:param name="n" as="xs:integer"/>
    <xsl:message select="'computing ' || $n"/>
    <xsl:sequence select="$n * $n"/>
  </xsl:function>
  <xsl:template match="/">
    <xsl:variable name="a" select="f:square(xs:integer(items/item[1]/@n) + 1)"/>
    <xsl:variable name="b" select="f:square(xs:integer(items/item[2]/@n))"/>
    <xsl:variable name="c" select="f:square(xs:integer(items/item[3]/@n))"/>
    <out a="{$a}" b="{$b}" c="{$c}"/>
  </xsl:template>
</xsl:stylesheet>
