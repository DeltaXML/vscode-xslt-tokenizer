<?xml version="1.0" encoding="UTF-8"?>
<!--
    A stylesheet to experiment with: it uses the invoicing package (lib/invoicing.xsl), but doesn't override the
    package's abstract components yet - so the xsl:use-package has a warning, and running it stops with XTDE3052, as
    inv:total calls inv:tax-rate.

    Things to try:
    - on the warning, the quick fixes: override all the abstract components, or one of them
    - with the cursor in the xsl:use-package, the refactoring 'Override Package Components...' - which offers
      inv:format-amount#1 too
    - in an xsl:override, type < for an 'override ...' declaration of each component
    - call inv:tax-rate: it can't be used until it's overridden - there's a quick fix for that too
    - add <xsl:accept component="function" names="inv:total" visibility="private"/> to the xsl:use-package: a function
      name needs its arity (XTSE3020), with a quick fix
    - declare a function named inv:total here: it has the name of a package component (XTSE3050), with a quick fix to
      move it into an xsl:override
-->
<xsl:stylesheet version="3.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:inv="http://example.com/invoicing"
    exclude-result-prefixes="#all" expand-text="yes">

    <xsl:use-package name="http://example.com/invoicing"/>

    <xsl:output method="text"/>

    <xsl:template match="/">
        <xsl:for-each select="invoices/invoice">
            <xsl:text>Invoice {@number}: {inv:format-amount(inv:total(.))}&#10;</xsl:text>
        </xsl:for-each>
    </xsl:template>

</xsl:stylesheet>
