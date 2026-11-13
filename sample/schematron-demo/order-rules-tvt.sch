<?xml version="1.0" encoding="UTF-8"?>
<!--
  order-rules.sch, with text value templates in its messages instead of sch:value-of: e.g.
    Order {$id} has an invalid date: {@date}
  instead of
    Order <value-of select="$id"/> has an invalid date: <value-of select="@date"/>
  They're an option of SchXslt2 - the Schematron processor bundled with XSpec - for every schema: the setting
  XSLT.schematron.expandText. With it on, 'tvt:on' is in the status bar for this file; without it, the braces are text,
  and in the report as they're written.

  Things to try:
  - turn on XSLT.schematron.expandText: the text value templates are highlighted as XPath, and checked as you edit
  - with orders.xml in the editor - which is associated with order-rules.sch - 'XSLT: Validate with Schematron (Choose
    Schema)...' and choose this one: the messages are those of order-rules.sch
  - Rename (F2) the id of <let name="id">: its references in the messages are renamed too - and hover over one, or Go
    to Definition (F12)
  - type {$ in a message: the variables in scope - and a brace as text is written {{ or }}
  - the titles: text value templates are evaluated in them too, e.g. the limit in the 'Order totals' pattern's name in
    the SVRL report
  - not everywhere: the abstract pattern in shared/required-attribute.sch keeps <value-of select="'$required'"/>, as
    SchXslt2 replaces its parameters only in attributes. Change it to {$required}: it's reported, with a quick fix
-->
<schema xmlns="http://purl.oclc.org/dsdl/schematron"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    queryBinding="xslt3" defaultPhase="all-checks">

  <title>Order rules</title>

  <ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/>
  <ns prefix="o" uri="urn:example:orders"/>

  <!-- functions in an XSLT module: o:line-total, o:order-total and o:is-email -->
  <xsl:include href="lib/order-functions.xsl"/>
  <!-- an abstract pattern, in another file -->
  <include href="shared/required-attribute.sch"/>

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
    <title>Order totals - up to {$max-order-total}</title>
    <rule context="order">
      <assert test="o:order-total(.) le $max-order-total" id="order-limit" severity="warning">Order {@id} totals {o:order-total(.)} - more than the limit of {$max-order-total}</assert>
    </rule>
  </pattern>

  <diagnostics>
    <diagnostic id="duplicate-id">{count(//order[@id = current()/@id])} orders have the id {@id}</diagnostic>
  </diagnostics>

</schema>
