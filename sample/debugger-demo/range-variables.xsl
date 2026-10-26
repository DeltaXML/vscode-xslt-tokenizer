<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                exclude-result-prefixes="#all"
                version="3.0">

  <xsl:output method="xml" indent="yes"/>

  <xsl:param name="discount" as="xs:decimal" select="0.1"/>
  <xsl:variable name="currency" as="xs:string" select="'GBP'"/>
  <xsl:variable name="myOrder" as="element()?" select="/orders/order[2]/nothing"/>

  <xsl:template match="/orders">
    <totals currency="{$currency}">
      <xsl:apply-templates select="order"/>
    </totals>
  </xsl:template>

  <xsl:template match="order">
    <xsl:variable name="customer" as="xs:string" select="@customer"/>
    <xsl:variable name="c1" as="element()?" select="element1"/>
    <xsl:variable name="cNew" as="element()?" select="$c1/element2[empty(@id)]/element3"/>
    <xsl:variable name="cNew2" as="item()*" select="
      'test', $c1/element2[exists(@id)]
      /element3"/>
    <xsl:variable name="c2" as="element()?" select="element1/child::element2"/>
    <xsl:variable name="c3" as="element()?" select="element1/parent::order/element1/element2/element3"/>

    <xsl:variable name="c4" as="attribute()?" select="element1/element2/element3/@attribute1"/>
    <wrapper>
      <xsl:sequence select="$c4"/>
    </wrapper>
    <xsl:sequence select="$c1,$c2,$c3, $cNew, $cNew2, $myOrder"/>
    <xsl:variable name="line-totals" as="xs:decimal*" select="
      for $line in line
      return
      let $x := count($line) + 2, 
          $y := count($line) + 31,
          $a := count($line) + 32,
          $b := count($line) + 33,
          $c := count($line) + 34,
          $sum := $x + $y + $a + $c + $b
        return 
          xs:integer($line/@qty) * $sum + xs:decimal($line/@price) * (1 - $discount)"/>
    <order id="{@id}" customer="{$customer}" total="{sum($line-totals)}"/>
  </xsl:template>

</xsl:stylesheet>
