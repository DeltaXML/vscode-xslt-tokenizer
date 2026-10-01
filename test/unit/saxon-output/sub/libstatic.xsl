<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:f="f" exclude-result-prefixes="#all" version="3.0">
  <xsl:function name="f:lib" as="xs:integer">
    <xsl:sequence select="'abc'"/>
  </xsl:function>
</xsl:stylesheet>
