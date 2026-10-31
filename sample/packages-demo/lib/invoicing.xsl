<?xml version="1.0" encoding="UTF-8"?>
<!--
    An XSLT 3.0 package, used by invoice-report.xsl and starter.xsl. They find it by its name and version, not its
    path: the extension finds every xsl:package in the workspace, and passes the ones a stylesheet uses to Saxon.

    Things to try:
    - code lenses (editor.codeLens): inv:tax-rate, inv:header and inv:format-amount are overridden in invoice-report.xsl
    - on the name of inv:tax-rate, Go to Implementations (Cmd+F12) - or Find All References - for its overrides
    - delete the xsl:mode for inv:render: in a package, each mode used must be declared (XTSE3085), with quick fixes
    - change the visibility of inv:format-amount to "final": invoice-report.xsl can't override it now (XTSE3060)
-->
<xsl:package name="http://example.com/invoicing" package-version="1.2" version="3.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:inv="http://example.com/invoicing"
    exclude-result-prefixes="#all" expand-text="yes">

    <xsl:note use-when="false()" format="xdoc-md">
        Renders invoices as HTML tables, with their totals and tax.

        A stylesheet using this package must override its abstract components - `inv:tax-rate#1` and
        `template inv:header` - and may override `inv:format-amount#1`, for another format.

        @param $inv:currency the ISO 4217 code of the invoices' currency
        @author Demo Team
        @version 1.2
    </xsl:note>

    <!-- the package's functions are final - they can be used, but not overridden - unless they say otherwise -->
    <xsl:expose component="function" names="inv:*" visibility="final"/>

    <!-- a global parameter is always public -->
    <xsl:param name="inv:currency" as="xs:string" select="'GBP'"/>

    <xsl:mode name="inv:render" visibility="public"/>

    <xsl:attribute-set name="inv:table" visibility="public">
        <xsl:attribute name="class">invoice</xsl:attribute>
    </xsl:attribute-set>

    <xsl:function name="inv:total" as="xs:decimal">
        <xsl:note use-when="false()" format="xdoc-md">
            Returns the total of an invoice, with tax at the rate for its country.

            @param $invoice the invoice
            @return the total, in the invoice's currency
            @see inv:tax-rate#1
        </xsl:note>
        <xsl:param name="invoice" as="element(invoice)"/>
        <xsl:variable name="net" as="xs:decimal" select="sum($invoice/line ! inv:line-total(.))"/>
        <xsl:sequence select="$net + $net * inv:tax-rate($invoice/@country)"/>
    </xsl:function>

    <xsl:function name="inv:format-amount" as="xs:string" visibility="public">
        <xsl:note use-when="false()" format="xdoc-md">
            Formats an amount with its currency code, e.g. `GBP 1,250.00`.

            @param $amount the amount
            @return the amount, as text
        </xsl:note>
        <xsl:param name="amount" as="xs:decimal"/>
        <xsl:sequence select="$inv:currency || ' ' || format-number($amount, '#,##0.00')"/>
    </xsl:function>

    <xsl:function name="inv:tax-rate" as="xs:decimal" visibility="abstract">
        <xsl:note use-when="false()" format="xdoc-md">
            Returns the tax rate for a country, e.g. `0.2` for 20% - each stylesheet using the package must provide it.

            @param $country the ISO 3166 code of the customer's country, e.g. `GB`
            @return the rate, from 0 to 1
        </xsl:note>
        <xsl:param name="country" as="xs:string"/>
    </xsl:function>

    <!-- private: for the package's own use -->
    <xsl:function name="inv:line-total" as="xs:decimal" visibility="private">
        <xsl:param name="line" as="element(line)"/>
        <xsl:sequence select="xs:decimal($line/@quantity) * xs:decimal($line/@price)"/>
    </xsl:function>

    <xsl:template name="inv:header" visibility="abstract">
        <xsl:note use-when="false()" format="xdoc-md">
            Renders the heading of an invoice, e.g. its number and customer.

            @param $invoice the invoice
        </xsl:note>
        <xsl:param name="invoice" as="element(invoice)" required="yes"/>
    </xsl:template>

    <xsl:template match="invoice" mode="inv:render">
        <section>
            <xsl:call-template name="inv:header">
                <xsl:with-param name="invoice" select="."/>
            </xsl:call-template>
            <table xsl:use-attribute-sets="inv:table">
                <tr><th>Item</th><th>Quantity</th><th>Amount</th></tr>
                <xsl:apply-templates select="line" mode="#current"/>
                <tr><th colspan="2">Total, with tax</th><td>{inv:format-amount(inv:total(.))}</td></tr>
            </table>
        </section>
    </xsl:template>

    <xsl:template match="line" mode="inv:render">
        <tr><td>{@description}</td><td>{@quantity}</td><td>{inv:format-amount(inv:line-total(.))}</td></tr>
    </xsl:template>

</xsl:package>
