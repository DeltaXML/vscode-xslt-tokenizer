<?xml version="1.0" encoding="UTF-8"?>
<!-- XPath 4.0 pipeline operator '->' - the right-hand operand is evaluated with the context value bound to the left-hand result -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="4.0">

  <?test-attribute select?>
  <xsl:variable name="pipeline1" select="'a b c' -> tokenize(.) -> count(.) -> concat('count=', .)"/>
  <xsl:variable name="pipeline2" select="(1 to 10) ! (. * 2) -> sum(.)"/>
  <xsl:variable name="pipeline3" select="(1 to 4) -> for-each(., abs#1) -> exists(.)"/>
  <xsl:variable name="pipeline4" select="(1, 2, 3) -> (. + 1)"/>
  <xsl:variable name="pipeline5" select="(1, 2, 3)->count(.)"/>
  <xsl:variable name="pipeline6" select="(1, 2) -> (if (. gt 2) then . else 0)"/>
  <xsl:variable name="pipeline7" select="(1, 2) -> -. * 2"/>
  <xsl:variable name="pipeline8" select="(1, 2) -> . => string() cast as xs:string"/>
  <xsl:variable name="pipeline9" select="let $a := (1, 2) -> . return $a -> (., .)"/>
  <xsl:variable name="pipeline10" select="map { 'a': (1, 2) -> ., 'b': 2 }"/>
  <xsl:variable name="pipeline11" select="(1, 2) -> [., .]"/>
  <xsl:variable name="pipeline12" select="(1, 2) -> .?*"/>
  <!-- expect missing context item errors: -->
  <xsl:variable name="pipelineError1" select="(1, 2) -> . + ."/>
  <xsl:variable name="pipelineError2" select="((1, 2) -> .), ."/>
  <xsl:variable name="pipelineError3" select="(1, 2) -> string(.), count(.)"/>
  <xsl:variable name="pipelineError4" select="let $a := (1, 2) -> . return ."/>
  <xsl:variable name="pipelineError5" select="(1, 2) -> current()"/>
</xsl:stylesheet>
