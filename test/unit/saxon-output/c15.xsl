<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="f" exclude-result-prefixes="#all" version="3.0">
  <xsl:template match="a">
    <xsl:variable name="n" as="xs:integer" select="xs:integer(.) + string(.)"/>
    <x><xsl:sequence select="$n"/></x>
  </xsl:template>
</xsl:stylesheet>
