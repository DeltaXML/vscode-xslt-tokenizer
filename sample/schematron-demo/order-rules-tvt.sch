<?xml version="1.0" encoding="UTF-8"?>
<!--
  order-rules.sch, with text value templates in its messages instead of sch:value-of: e.g.
    Order {$id} has an invalid date: {@date}
  instead of
    Order <value-of select="$id"/> has an invalid date: <value-of select="@date"/>
  They're a non-standard extension: with xsl:expand-text="yes" - on the schema below, as in XSLT - and the setting
  XSLT.schematron.allowExpandText on. The extension rewrites them as sch:value-of for 'Schematron: Validate' and
  XSpec tests - and 'Schematron: Export Standard Copy...' writes a copy that way, for other Schematron processors.

  Things to try:
  - without the setting: xsl:expand-text below is reported as ignored, and the braces are text
  - turn on XSLT.schematron.allowExpandText: the text value templates are highlighted as XPath, and checked as you edit
  - with orders.xml in the editor - which is associated with order-rules.sch - 'Schematron: Validate (Choose Schema)...'
    and choose this one: the messages are those of order-rules.sch
  - Rename (F2) the id of <let name="id">: its references in the messages are renamed too - and hover over one, or Go
    to Definition (F12)
  - type {$ in a message: the variables in scope - and a brace as text is written {{ or }}
  - xsl:expand-text="no" on a pattern, rule or assertion: the braces within it are text
  - shared/required-attribute-tvt.sch has its own xsl:expand-text: each file included decides for itself
  - 'Schematron: Export Standard Copy...': the copy has sch:value-of, with the abstract pattern included
-->
<schema xmlns="http://purl.oclc.org/dsdl/schematron"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xsl:expand-text="yes"
    queryBinding="xslt3" defaultPhase="all-checks">

  <title>Order rules</title>

  <ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/>
  <ns prefix="o" uri="urn:example:orders"/>

  <!-- functions in an XSLT module: o:line-total, o:order-total and o:is-email -->
  <xsl:include href="lib/order-functions.xsl"/>
  <!-- an abstract pattern, in another file -->
  <include href="shared/required-attribute-tvt.sch"/>

  <let name="max-order-total" value="150"/>

  <phase id="structure">
    <p>Structure only: ids, dates and customers</p>
    <active pattern="orders"/>
    <active pattern="customer-names"/>
    <active pattern="customers"/>
  </phase>
  <phase id="all-checks">
    <p>Every check, including the lines and order totals</p>
    <active pattern="orders"/>
    <active pattern="customer-names"/>
    <active pattern="customers"/>
    <active pattern="lines"/>
    <active pattern="order-totals"/>
  </phase>

  <pattern id="orders">
    <title>Orders</title>
    <rule context="order">
      <let name="id" value="@id"/>
      <assert test="count(//order[@id = $id]) = 1" id="unique-id" diagnostics="duplicate-id">Order {$id} must have an id of its own</assert>
      <assert test="@date castable as xs:date" id="valid-date">Order {$id} has an invalid date: {@date}</assert>
    </rule>
  </pattern>

  <!-- an instance of the abstract pattern: a customer needs a name -->
  <pattern id="customer-names" is-a="required-attribute">
    <param name="element" value="customer"/>
    <param name="required" value="@name"/>
  </pattern>

  <pattern id="customers">
    <title>Customers</title>
    <rule context="customer">
      <assert test="@email" id="has-email" severity="warning">The customer {@name} has no email address</assert>
      <assert test="not(@email) or o:is-email(@email)" id="valid-email" severity="warning">The email address {@email} isn't valid</assert>
    </rule>
  </pattern>

  <pattern id="lines">
    <title>Order lines</title>
    <!-- copied into each rule that extends it -->
    <rule abstract="true" id="numeric-line">
      <assert test="@quantity castable as xs:integer and xs:integer(@quantity) gt 0" id="positive-quantity">The quantity of {@product} must be a whole number above 0</assert>
      <assert test="@price castable as xs:decimal" id="decimal-price">The price of {@product} isn't a number: {@price}</assert>
    </rule>
    <rule context="line">
      <extends rule="numeric-line"/>
      <let name="total" value="o:line-total(.)"/>
      <report test="$total gt 100" id="large-line" role="info">The line for {@product} totals {$total}</report>
    </rule>
  </pattern>

  <pattern id="order-totals">
    <title>Order totals</title>
    <rule context="order">
      <assert test="o:order-total(.) le $max-order-total" id="order-limit" severity="warning">Order {@id} totals {o:order-total(.)} - more than the limit of {$max-order-total}</assert>
    </rule>
  </pattern>

  <diagnostics>
    <diagnostic id="duplicate-id">{count(//order[@id = current()/@id])} orders have the id {@id}</diagnostic>
  </diagnostics>

</schema>
