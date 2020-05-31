<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  exclude-result-prefixes="xs"
  version="3.0">
  
  <xsl:key name="book-id" match="book" use="@id"/>
  
  <xsl:accumulator name="acc" initial-value="2">
    <xsl:accumulator-rule match="test">
      <xsl:sequence select="$value + 1"/>
    </xsl:accumulator-rule>
  </xsl:accumulator>
  
  <xsl:template match="/">
    <xsl:sequence select="key('book-id', 'test')"/>
    <xsl:sequence select="accumulator-before('acc')"/>
  </xsl:template>
  
</xsl:stylesheet>