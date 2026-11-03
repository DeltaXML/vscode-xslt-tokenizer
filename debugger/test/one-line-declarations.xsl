<?xml version="1.0" encoding="UTF-8"?>
<!-- declarations each on one line: a breakpoint on the line stops once for each call - at the entry, not again at the
     XPath expression of the instruction in it -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:f="urn:f" version="3.0">
  <xsl:function name="f:double"><xsl:param name="n"/><xsl:sequence select="$n * 2"/></xsl:function>
  <xsl:template match="item"><xsl:value-of select="f:double(xs:integer(.))" xmlns:xs="http://www.w3.org/2001/XMLSchema"/></xsl:template>
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="items" as="element()*"><item>1</item><item>2</item></xsl:variable>
    <out><xsl:apply-templates select="$items"/><xsl:sequence select="f:double(10)"/></out>
  </xsl:template>
</xsl:stylesheet>
