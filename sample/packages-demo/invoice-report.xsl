<?xml version="1.0" encoding="UTF-8"?>
<!--
    A stylesheet that uses the invoicing package (lib/invoicing.xsl): it implements the package's abstract components,
    overrides one of its public functions, and renders invoices with the package's public mode. Run it with Quick Run,
    with invoices.xml - or the task in .vscode/tasks.json.

    Things to try:
    - hover over the name of the xsl:use-package: the package's note, and the components this stylesheet can use
    - hover over inv:total or inv:format-amount in a call, and over the names of the declarations in xsl:override
    - code lenses (editor.codeLens) on the declarations in xsl:override, which go to the package's declarations
    - Go to Declaration on xsl:original, or on the name of an overriding declaration
    - hover over @see inv:tax-rate#1 in a note: it's the package's declaration, not the one it's in
    - change the type of $country to xs:NCName: the signature doesn't match the package's (XTSE3070), with a quick fix
    - call inv:line-total, which is private in the package
-->
<xsl:stylesheet version="3.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:inv="http://example.com/invoicing"
    exclude-result-prefixes="#all" expand-text="yes">

    <xsl:use-package name="http://example.com/invoicing" package-version="1.*">
        <xsl:override>
            <xsl:function name="inv:tax-rate" as="xs:decimal">
                <xsl:note use-when="false()" format="xdoc-md">
                    VAT: 20% in the UK and 19% in Germany - none elsewhere.

                    @see inv:tax-rate#1
                </xsl:note>
                <xsl:param name="country" as="xs:string"/>
                <xsl:sequence select="if ($country = 'GB') then 0.2 else if ($country = 'DE') then 0.19 else 0"/>
            </xsl:function>
            <xsl:template name="inv:header">
                <xsl:param name="invoice" as="element(invoice)" required="yes"/>
                <h2>Invoice {$invoice/@number}: {$invoice/customer}</h2>
            </xsl:template>
            <xsl:function name="inv:format-amount" as="xs:string">
                <xsl:note use-when="false()" format="xdoc-md">
                    Formats an amount with a currency symbol, e.g. `£1,250.00` - or for a currency without one, as the
                    package does.

                    @see inv:format-amount#1
                </xsl:note>
                <xsl:param name="amount" as="xs:decimal"/>
                <xsl:variable name="symbol" as="xs:string?" select="map { 'GBP': '£', 'EUR': '€', 'USD': '$' }($inv:currency)"/>
                <xsl:sequence select="if (exists($symbol)) then $symbol || format-number($amount, '#,##0.00') else xsl:original($amount)"/>
            </xsl:function>
        </xsl:override>
    </xsl:use-package>

    <xsl:output method="html" html-version="5" indent="yes"/>

    <xsl:template match="/">
        <html>
            <head><title>Invoices</title></head>
            <body>
                <h1>Invoices</h1>
                <xsl:apply-templates select="invoices/invoice" mode="inv:render"/>
                <p>Total of all invoices: {inv:format-amount(sum(invoices/invoice ! inv:total(.)))}</p>
            </body>
        </html>
    </xsl:template>

</xsl:stylesheet>
