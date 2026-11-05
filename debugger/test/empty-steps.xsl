<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:o="urn:orders" xmlns:f="urn:f" exclude-result-prefixes="#all">
  <xsl:variable name="doc" as="document-node()">
    <xsl:document><orders xmlns="urn:orders"><order id="1"><item n="1"/><Item n="2"/></order></orders></xsl:document>
  </xsl:variable>
  <xsl:template name="xsl:initial-template">
    <xsl:variable name="m" select="map{'id': 1, 'title': 'x'}"/>
    <xsl:variable name="items" select="$doc/orders/order/item"/>
    <xsl:variable name="keyed" select="$m?name"/>
    <xsl:variable name="found" select="$doc/o:orders/o:order/o:item[@n = 5]"/>
    <xsl:variable name="fine" select="$doc/o:orders/o:order/o:item[@n = 1]"/>
    <xsl:variable name="called" select="f:orders()/o:order/o:none"/>
    <xsl:sequence select="count(($items, $keyed, $found, $fine, $called))"/>
  </xsl:template>
  <xsl:function name="f:orders" as="element()">
    <xsl:sequence select="$doc/o:orders"/>
  </xsl:function>
</xsl:stylesheet>
