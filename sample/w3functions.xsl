<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet 
	xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
	xmlns:xs="http://www.w3.org/2001/XMLSchema"
	xmlns:array="http://www.w3.org/2005/xpath-functions/array"
	xmlns:map="http://www.w3.org/2005/xpath-functions/map"
	xmlns:fn="any.com"
	xmlns:math="http://www.w3.org/2005/xpath-functions/math"
	exclude-result-prefixes="#all"
	expand-text="yes"
	version="3.0">
	
	<xsl:variable name="foldLeft" as="" 
		select="fn:fold-left(1 to 5, 0, function($a, $b) { $a + $b })"/>
	
	<xsl:variable name="forEachPair" as="" select="fn:for-each-pair(('a', 'b', 'c'), ('x', 'y', 'z'), starts-with#2)"/>
	
	<xsl:function name="fn:fold-left" as="item()*">
		<xsl:param name="seq" as="item()*"/>
		<xsl:param name="zero" as="item()*"/>
		<xsl:param name="f" as="function(item()*, item()) as item()*"/>
		<xsl:choose>
			<xsl:when test="empty($seq)">
				<xsl:sequence select="$zero"/>
			</xsl:when>
			<xsl:otherwise>
				<xsl:sequence select="fn:fold-left(tail($seq), $f($zero, head($seq)), $f)"/>
			</xsl:otherwise>
		</xsl:choose>
	</xsl:function>
	
	<xsl:function name="fn:for-each-pair">
		<xsl:param name="seq1"/>
		<xsl:param name="seq2"/>
		<xsl:param name="action"/>
		<xsl:if test="exists($seq1) and exists($seq2)">
			<xsl:sequence select="$action(head($seq1), head($seq2))"/>
			<xsl:sequence select="fn:for-each-pair(tail($seq1), tail($seq2), $action)"/>
		</xsl:if>
	</xsl:function>
	
	
	
</xsl:stylesheet>