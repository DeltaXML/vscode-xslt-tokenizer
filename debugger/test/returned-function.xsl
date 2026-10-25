<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:function name="f:counter" as="function(*)">
    <xsl:param name="n" as="xs:integer"/>
    <xsl:variable name="next" as="xs:integer" select="$n + 1"/>
    <xsl:sequence select="function() as item()* {
      (f:counter($next),
       $n * 10)
      }"/>
  </xsl:function>
  <xsl:template match="/">
    <out>
      <xsl:iterate select="items/item">
        <xsl:param name="counter" as="function(*)" select="f:counter(count(items/item) - 2)"/>
        <xsl:variable name="result" as="item()*" select="$counter()"/>
        <value><xsl:sequence select="$result[2]"/></value>
        <xsl:next-iteration>
          <xsl:with-param name="counter" select="$result[1]"/>
        </xsl:next-iteration>
      </xsl:iterate>
    </out>
  </xsl:template>
</xsl:stylesheet>
