<?xml version="1.0" encoding="UTF-8"?>
<!--
  Stepping through multi-line XPath with the SaxonJ debugger

  1. Open orders.xml (it becomes the XML context file), then this stylesheet
  2. Start debugging: 'XSLT: Debug Stylesheet with SaxonJ', the debug button in the editor title, or F5
  3. Try:
     - a breakpoint on the <xsl:variable name="total"> line, then Step Into: the steps go through the
       'for ... return' expression, line by line, and into f:line-total - see $line in the Variables view
     - a breakpoint on the 'f:line-total($line)' line inside that expression: it stops for each line
       element, with the order as the context item
     - a breakpoint on a line inside the multi-line 'test' of the xsl:if
     - in xsl:for-each-group, a breakpoint inside $summary's expression - then watch count(current-group())
     - a breakpoint on a 'then' or 'return' line: shown as unverified - nothing is evaluated starting there
  The value of each expression stepped through is shown in the Debug Console.
-->
<xsl:stylesheet version="3.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:f="urn:debugger-demo"
    exclude-result-prefixes="#all">

  <xsl:output method="xml" indent="yes"/>

  <xsl:param name="discount-threshold" as="xs:decimal" select="20"/>
  <xsl:param name="discount-rate" as="xs:decimal" select="0.1"/>

  <xsl:template match="/">
    <report>
      <xsl:apply-templates select="orders/order"/>
      <xsl:call-template name="by-category"/>
    </report>
  </xsl:template>

  <xsl:template match="order">
    <xsl:variable name="total" as="xs:decimal" select="
      sum(
        for $line in line
        return
          f:line-total($line)
      )"/>
    <xsl:variable name="discount" as="xs:decimal" select="
      if ($total ge $discount-threshold)
      then
        round($total * $discount-rate, 2)
      else
        0"/>
    <order id="{@id}" customer="{@customer}" total="{$total - $discount}">
      <xsl:if test="
          $discount gt 0
          and count(line) gt 1">
        <discount amount="{$discount}"/>
      </xsl:if>
      <xsl:sequence select="
        string-join(
          for $line in sort(line, (), function ($l) { string($l/@product) })
          return
            $line/@product || ' x' || $line/@qty,
          ', '
        )"/>
    </order>
  </xsl:template>

  <xsl:template name="by-category">
    <xsl:for-each-group select="orders/order/line" group-by="@category">
      <xsl:sort select="current-grouping-key()"/>
      <xsl:variable name="summary" select="
        current-grouping-key()
        || ': '
        || count(current-group())
        || ' lines, '
        || sum(
             current-group() ! f:line-total(.)
           )"/>
      <category name="{current-grouping-key()}">
        <xsl:value-of select="$summary"/>
      </category>
    </xsl:for-each-group>
  </xsl:template>

  <xsl:function name="f:line-total" as="xs:decimal">
    <xsl:param name="line" as="element(line)"/>
    <xsl:variable name="qty" as="xs:decimal" select="xs:decimal($line/@qty)"/>
    <xsl:sequence select="
      $qty
      * xs:decimal($line/@price)"/>
  </xsl:function>

</xsl:stylesheet>
