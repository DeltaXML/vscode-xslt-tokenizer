<?xml version="1.0" encoding="UTF-8"?>
<!-- Functions for order-rules.sch, which includes this module with xsl:include - SchXslt2 copies the include into the
     stylesheet it compiles the schema to, so the functions can be called in the schema's XPath -->
<xsl:stylesheet version="3.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:o="urn:example:orders"
    exclude-result-prefixes="#all">

  <!-- a line's quantity times its price - 0 when either isn't a number -->
  <xsl:function name="o:line-total" as="xs:decimal">
    <xsl:param name="line" as="element(line)"/>
    <xsl:sequence select="if ($line/@quantity castable as xs:integer and $line/@price castable as xs:decimal)
                          then xs:integer($line/@quantity) * xs:decimal($line/@price)
                          else 0"/>
  </xsl:function>

  <xsl:function name="o:order-total" as="xs:decimal">
    <xsl:param name="order" as="element(order)"/>
    <xsl:sequence select="sum($order/line ! o:line-total(.))"/>
  </xsl:function>

  <xsl:function name="o:is-email" as="xs:boolean">
    <xsl:param name="text" as="xs:string?"/>
    <xsl:sequence select="matches($text, '^[^@\s]+@[^@\s]+\.[^@\s]+$')"/>
  </xsl:function>

</xsl:stylesheet>
