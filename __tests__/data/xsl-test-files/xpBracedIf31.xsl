<?xml version="1.0" encoding="UTF-8"?>
<!-- XPath 4.0 braced if expressions, if (C) {T} with no 'then' or 'else', are errors in XPath 3.1 (keep test expressions in sync with xpBracedIf40.xsl) -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="3.0">

  <?test-attribute select?>
  <xsl:variable name="bracedIf1" select="if (true()) { 1 }"/>
  <xsl:variable name="bracedIf2" select="if (true()) {}"/>
  <xsl:variable name="bracedIf3" select="if (true()) { 1, 2 }"/>
  <xsl:variable name="bracedIf4" select="(if (true()) { 1 }, 2)"/>
  <xsl:variable name="bracedIf5" select="if (true()) { if (false()) { 1 } }"/>
  <xsl:variable name="bracedIf6" select="if (true()) { if (false()) then 1 else 2 }"/>
  <xsl:variable name="bracedIf7" select="if (true()) then if (false()) { 1 } else 2"/>
  <xsl:variable name="bracedIf8" select="let $a := 1 return if ($a eq 1) { 'one' }"/>
  <xsl:variable name="bracedIf9" select="for $a in (1, 2) return if ($a gt 1) { $a }"/>
  <xsl:variable name="bracedIf10" select="if (true()) { map { 'a': 1 } }"/>
  <xsl:variable name="bracedIf11" select="if (true()) { (: comment :) 1 }"/>
  <xsl:variable name="bracedIf12" select="if (true()) (: comment :) { 1 }"/>
  <xsl:variable name="unbracedIf1" select="if (true()) then 1 else 2"/>
  <xsl:variable name="bracedIfError1" select="if (true()) { 1 } else { 2 }"/>
  <xsl:variable name="bracedIfError2" select="if (true()) 1"/>
  <xsl:variable name="bracedIfError3" select="if (true()) then 1"/>
</xsl:stylesheet>
