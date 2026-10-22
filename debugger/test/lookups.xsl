<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:function name="f:key"><xsl:param name="k"/><xsl:message select="'key ' || $k"/><xsl:sequence select="$k"/></xsl:function>
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="m" select="map{'name': 'Ada', 'langs': ['xslt', 'xpath']}"/>
    <xsl:variable name="name" select="
      $m
      ?name"/>
    <xsl:variable name="all" select="
      $m
      ?langs
      ?*"/>
    <xsl:variable name="second" select="
      $m?langs
      ?2"/>
    <xsl:variable name="computed" select="
      $m
      ?(f:key('name'))"/>
    <xsl:variable name="end" select="1"/>
    <out name="{$name}" all="{$all}" second="{$second}" computed="{$computed}"/>
  </xsl:template>
</xsl:stylesheet>
