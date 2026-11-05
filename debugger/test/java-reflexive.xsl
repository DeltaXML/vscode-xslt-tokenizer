<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:math="java:java.lang.Math" xmlns:g="java:demo.Greeter" exclude-result-prefixes="#all">
  <xsl:template match="/">
    <xsl:variable name="names" select="items/item/@n ! string()"/>
    <xsl:variable name="results" select="
      for $n in $names
      return
        g:greet($n) || ' ' || math:sqrt(number($n) * 4)"/>
    <out><xsl:value-of select="$results" separator=", "/></out>
  </xsl:template>
</xsl:stylesheet>
