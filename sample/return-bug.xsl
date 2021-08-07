<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
																xmlns:xs="http://www.w3.org/2001/XMLSchema"
																xmlns:array="http://www.w3.org/2005/xpath-functions/array"
																xmlns:map="http://www.w3.org/2005/xpath-functions/map"
																xmlns:math="http://www.w3.org/2005/xpath-functions/math"
																exclude-result-prefixes="#all"
																expand-text="yes"
																version="3.0">
	
	<!-- <xsl:variable name="test"
						select="
						if (2) then (let $colspecs := 1, $b := 2 return $colspecs, $b) else 0
						"/>  />	
						
						<xsl:variable name="test2"
						select="
						if (2) then let $colspecs := 1 return ($colspecs) else 0
						"/>
						
						<xsl:variable name="test3"
						select="
						if (2) then 3 else 4
						"/>
	
	<xsl:variable name="test4"
		select="
			if (2) then 3 else if (4) then 5 else 6
		"/>  -->
	
	<xsl:variable name="new-diff-col-count" as="xs:integer" 
		select="
			if (2) then 
				let $av := 3, $bv := 4 return 
					(: following should show error for ',' - expected 'else':)
					if ($av) then 5 else let $cv := 9 return $bv, $cv
			else 2"/>
	
</xsl:stylesheet>