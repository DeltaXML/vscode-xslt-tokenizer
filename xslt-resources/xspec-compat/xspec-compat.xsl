<?xml version="1.0" encoding="UTF-8"?>
<!--
  XSpec's compiler, compile-xslt-tests.xsl - with the test runner it makes changed to run tests written for XSpec before
  1.0 (e.g. 0.5) as that ran them, where XSpec 4 stops the run instead. For the XSLT.xspec.legacyCompatibility setting:
  - an x:expect with a boolean @test and @select, @as, @href or content: the boolean decides, and the expected value is
    ignored - XSpec 4 stops with 'Boolean @test must not be accompanied by ...'
  - an x:expect with a @test that isn't boolean, and no expected value: it passes if the @test returns nothing, as it's
    compared with the empty sequence - XSpec 4 stops with 'Non-boolean @test must be accompanied by ...'
  - the xs prefix is declared for the test runner's expressions, as the old test runner declared it - XSpec 4 needs it
    declared in the XSpec file
  Each change is reported with xsl:message, as the compiler's output shows, so the tests can be updated.
  The changes are matched by XSpec's own messages, in the test runner it generates - so they're to be checked when the
  XSpec bundled with the extension is updated.
  compiler: the URI of XSpec's compile-xslt-tests.xsl
-->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:compat="urn:x-deltaxml:xspec-compat"
  exclude-result-prefixes="#all" version="3.0">

  <xsl:param name="compiler" as="xs:string" static="yes"/>

  <xsl:import _href="{$compiler}"/>

  <xsl:mode name="compat:runner" on-no-match="shallow-copy"/>

  <xsl:variable name="compat:boolean-with-comparison" as="xs:string" select="'Boolean @test must not be accompanied by'"/>
  <xsl:variable name="compat:non-boolean-without-comparison" as="xs:string" select="'Non-boolean @test must be accompanied by'"/>

  <!-- the test runner, as XSpec compiles it, changed -->
  <xsl:template match="document-node()">
    <xsl:variable name="runner" as="node()*">
      <xsl:next-match/>
    </xsl:variable>
    <xsl:if test="not(x:description/namespace::xs) and exists(//x:*/@*[matches(., '(^|[^\w.:-])xs:\i')])">
      <xsl:message select="'XSpec legacy compatibility: the xs prefix is used but not declared in the XSpec file - it''s declared for the test runner, as XSpec 0.5 did'"/>
    </xsl:if>
    <xsl:apply-templates select="$runner" mode="compat:runner"/>
  </xsl:template>

  <!-- the xs prefix declared for the test runner's expressions - on its xsl:stylesheet, which has no parent, as it's in a
    variable -->
  <xsl:template match="*[not(parent::node())][not(namespace::xs)]" mode="compat:runner">
    <xsl:copy>
      <xsl:namespace name="xs" select="'http://www.w3.org/2001/XMLSchema'"/>
      <xsl:apply-templates select="@* | node()" mode="#current"/>
    </xsl:copy>
  </xsl:template>

  <!-- a boolean @test with an expected value: the boolean decides -->
  <xsl:template match="xsl:message[@terminate = 'yes'][contains(., $compat:boolean-with-comparison)]" mode="compat:runner">
    <xsl:message select="compat:report(., 'has a boolean @test and an expected value (@select, @as, @href or content) - the boolean decides, as in XSpec 0.5')"/>
    <xsl:element name="xsl:sequence" namespace="http://www.w3.org/1999/XSL/Transform">
      <xsl:attribute name="select" select="'boolean($Q{urn:x-xspec:compile:impl}test-result)'"/>
    </xsl:element>
  </xsl:template>

  <!-- a @test that isn't boolean, without an expected value: compared with the empty sequence -->
  <xsl:template match="xsl:message[@terminate = 'yes'][contains(., $compat:non-boolean-without-comparison)]" mode="compat:runner">
    <xsl:message select="compat:report(., 'has a @test that isn''t boolean, and no expected value - it passes if the @test returns nothing, as in XSpec 0.5')"/>
    <xsl:element name="xsl:sequence" namespace="http://www.w3.org/1999/XSL/Transform">
      <xsl:attribute name="select" select="'empty($Q{urn:x-xspec:compile:impl}test-result)'"/>
    </xsl:element>
  </xsl:template>

  <!-- e.g. "XSpec legacy compatibility: x:expect ('a label') has ..." - from XSpec's "ERROR in x:expect ('a label'): ..." -->
  <xsl:function name="compat:report" as="xs:string">
    <xsl:param name="message" as="element()"/>
    <xsl:param name="change" as="xs:string"/>
    <xsl:variable name="expect" as="xs:string" select="replace(substring-before(string($message), '): '), '^ERROR in ', '') || ')'"/>
    <xsl:sequence select="'XSpec legacy compatibility: ' || $expect || ' ' || $change"/>
  </xsl:function>
</xsl:stylesheet>
