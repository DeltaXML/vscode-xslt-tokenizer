<?xml version="1.0" encoding="UTF-8"?>
<!--
    A currency package: its public functions convert and round amounts - tested by currency.xspec, as XSpec tests a
    package, with run-as="external". Its exchange rates are private.

    Things to try:
    - in the start tag of xsl:package: the code action to create a test file - with a scenario for each public function
-->
<xsl:package name="http://example.com/currency" package-version="1.0" version="3.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:c="http://example.com/currency"
    exclude-result-prefixes="#all">

  <xsl:function name="c:convert" as="xs:decimal" visibility="public">
    <xsl:param name="amount" as="xs:decimal"/>
    <xsl:param name="currency" as="xs:string"/>
    <xsl:sequence select="c:round($amount * c:rate($currency))"/>
  </xsl:function>

  <xsl:function name="c:round" as="xs:decimal" visibility="public">
    <xsl:param name="amount" as="xs:decimal"/>
    <xsl:sequence select="round-half-to-even($amount, 2)"/>
  </xsl:function>

  <!-- the rate from pounds - private, so the package's users, and its tests, can't call it -->
  <xsl:function name="c:rate" as="xs:decimal">
    <xsl:param name="currency" as="xs:string"/>
    <xsl:sequence select="map { 'GBP': 1.0, 'EUR': 1.17, 'USD': 1.27 }($currency)"/>
  </xsl:function>

</xsl:package>
