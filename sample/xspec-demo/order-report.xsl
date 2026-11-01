<?xml version="1.0" encoding="UTF-8"?>
<!--
    An order report: functions for the line totals and amounts, a named template for the heading, and template rules
    that turn orders.xml into an HTML report - tested by order-report.xspec (functions and templates) and
    order-rules.xspec (template rules). Run it with Quick Run, with orders.xml.

    Things to try:
    - in the start tag of a function or template: the code action 'Create XSpec scenario for …'
    - in the start tag of xsl:stylesheet: the code action to create a test file with a scenario for each declaration
    - Find All References on o:line-total: its uses in the XSpec files too
-->
<xsl:stylesheet version="3.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:o="http://example.com/orders"
    exclude-result-prefixes="#all" expand-text="yes">

  <xsl:output method="html" indent="yes"/>

  <!-- the total for a line: its quantity times its price, with a discount from 10 items -->
  <xsl:function name="o:line-total" as="xs:decimal">
    <xsl:param name="quantity" as="xs:integer"/>
    <xsl:param name="price" as="xs:decimal"/>
    <xsl:variable name="total" select="$quantity * $price"/>
    <xsl:sequence select="if ($quantity ge 10) then $total * 0.9 else $total"/>
  </xsl:function>

  <!-- an amount as currency, e.g. 1234.5 as '£1,234.50' -->
  <xsl:function name="o:format-amount" as="xs:string">
    <xsl:param name="amount" as="xs:decimal"/>
    <xsl:sequence select="'£' || format-number($amount, '#,##0.00')"/>
  </xsl:function>

  <xsl:template name="o:heading">
    <xsl:param name="title" as="xs:string"/>
    <xsl:param name="level" as="xs:integer" select="1"/>
    <xsl:element name="h{$level}">{$title}</xsl:element>
  </xsl:template>

  <xsl:template match="/orders">
    <html>
      <body>
        <xsl:call-template name="o:heading">
          <xsl:with-param name="title" select="'Orders'"/>
        </xsl:call-template>
        <xsl:apply-templates select="order"/>
      </body>
    </html>
  </xsl:template>

  <xsl:template match="order">
    <section id="{@id}">
      <xsl:call-template name="o:heading">
        <xsl:with-param name="title" select="'Order ' || @id"/>
        <xsl:with-param name="level" select="2"/>
      </xsl:call-template>
      <table>
        <xsl:apply-templates select="line"/>
      </table>
      <p class="total">Total: {o:format-amount(sum(line ! o:line-total(xs:integer(@quantity), xs:decimal(@price))))}</p>
    </section>
  </xsl:template>

  <xsl:template match="line">
    <tr>
      <td>{@product}</td>
      <td>{@quantity}</td>
      <td>{o:format-amount(o:line-total(xs:integer(@quantity), xs:decimal(@price)))}</td>
    </tr>
  </xsl:template>

</xsl:stylesheet>
