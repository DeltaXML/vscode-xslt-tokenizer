<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet 
	xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
	xmlns:xs="http://www.w3.org/2001/XMLSchema"
	xmlns:array="http://www.w3.org/2005/xpath-functions/array"
	xmlns:map="http://www.w3.org/2005/xpath-functions/map"
	xmlns:math="http://www.w3.org/2005/xpath-functions/math"
	exclude-result-prefixes="#all"
	expand-text="yes"
	version="3.0">
	
	<xsl:variable name="qq" select="let $a := 2 return, 2"/>
	
	<xsl:variable name="a" select="
		if (22) then 
			let $m := 5 return 5			
		else $m"/>
	
	<xsl:variable name="b" select="
		if (22) then 
			if (7) then 2 else 3	
		else 6"/>
	
	<xsl:variable select="(if (2) then 22 )"/> 
	
	<xsl:variable select="if (2) then 6 else 7"/> 	
	
	
	<xsl:variable select="
						if (22) then 
						22 
						else 
						if (22) then 
						25
						else 26
						else 22"/> 	
	
	<xsl:variable name="q" as="xs:string" 
		select="
			map {
				'a' : if (7) then 1 else 2,
				'b' : 2
			}	
		"/> 
	
				</xsl:stylesheet>