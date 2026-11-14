<?xml version="1.0" encoding="UTF-8"?>
<!--
  Rules for orders.xml - an ISO Schematron schema, checked as you edit it as SchXslt2 (the Schematron processor
  bundled with XSpec) runs it.

  Things to try:
  - Quick Run (the editor title's Run button): validates orders.xml - this schema's XML context file, in the status bar,
    inferred from its xml-model - with the schema in the editor. Click the status bar item to choose another file
  - validate: with orders.xml in the editor, 'Schematron: Validate' - the problems are in the
    Problems view, at the elements they're about; click a problem's id to come back to its assertion here
  - after validating: above each rule, the nodes it fired for
  - the phase, in the status bar - 'phase: all-checks (default)': click it to choose 'structure', which leaves out the
    lines and totals - Quick Run, Validate and Debug all use it

  Debugging - the editor title's Debug button validates orders.xml in the XSLT debugger, at this schema's lines:
  - in the Breakpoints view, check 'Failed Assertions': it pauses at each failure, on its node, with its message - the
    first is order A1's id, which another order has too. Edit its condition (the pencil) to 'error' to skip the warnings
  - a breakpoint on has-email's line, below: for Grace Hopper, @email is faded - empty for her node - and its hover
    lists the attributes she has
  - a breakpoint on the customer-names pattern: it pauses in the abstract pattern's rule, in shared/, named for this
    pattern - with $element and $required in the Variables view's Parameters
  - while paused: Step Over goes to the rule's next let or assertion; Watch and the Debug Console evaluate XPath on the
    rule's node, e.g. o:order-total(..)
  - when it ends: the problems are in the Problems view, as for Validate
  - hover over is-a="required-attribute": the abstract pattern's rules, with this pattern's values in place
  - hover over a rule's name, an assertion's name, extends' rule, or $max-order-total
  - Find All References on id="positive-quantity": the XSpec test in order-rules.xspec uses it too
  - add a rule with context="order" after the first one in the 'orders' pattern: it's reported as never firing
  - auto-completion in a test attribute: the variables in scope, and the element names of orders.xml
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
      <assert test="count(//order[@id = $id]) = 1" id="unique-id" diagnostics="duplicate-id">Order <value-of select="$id"/> must have an id of its own</assert>
      <assert test="@date castable as xs:date" id="valid-date">Order <value-of select="$id"/> has an invalid date: <value-of select="@date"/></assert>
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
      <assert test="@email" id="has-email" severity="warning">The customer <value-of select="@name"/> has no email address</assert>
      <assert test="not(@email) or o:is-email(@email)" id="valid-email" severity="warning">The email address <value-of select="@email"/> isn't valid</assert>
    </rule>
  </pattern>

  <pattern id="lines">
    <title>Order lines</title>
    <!-- copied into each rule that extends it -->
    <rule abstract="true" id="numeric-line">
      <assert test="@quantity castable as xs:integer and xs:integer(@quantity) gt 0" id="positive-quantity">The quantity of <value-of select="@product"/> must be a whole number above 0</assert>
      <assert test="@price castable as xs:decimal" id="decimal-price">The price of <value-of select="@product"/> isn't a number: <value-of select="@price"/></assert>
    </rule>
    <rule context="line">
      <extends rule="numeric-line"/>
      <let name="total" value="o:line-total(.)"/>
      <report test="$total gt 100" id="large-line" role="info">The line for <value-of select="@product"/> totals <value-of select="$total"/></report>
    </rule>
  </pattern>

  <pattern id="order-totals">
    <title>Order totals</title>
    <rule context="order">
      <assert test="o:order-total(.) le $max-order-total" id="order-limit" severity="warning">Order <value-of select="@id"/> totals <value-of select="o:order-total(.)"/> - more than the limit of <value-of select="$max-order-total"/></assert>
    </rule>
  </pattern>

  <diagnostics>
    <diagnostic id="duplicate-id"><value-of select="count(//order[@id = current()/@id])"/> orders have the id <value-of select="@id"/></diagnostic>
  </diagnostics>

</schema>
