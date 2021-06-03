<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
																xmlns:xs="http://www.w3.org/2001/XMLSchema"
																xmlns:array="http://www.w3.org/2005/xpath-functions/array"
																xmlns:map="http://www.w3.org/2005/xpath-functions/map"
																xmlns:math="http://www.w3.org/2005/xpath-functions/math"
																exclude-result-prefixes="#all"
																expand-text="yes"
																version="3.0">
	
	<xsl:output method="xml" indent="yes"/>
	<xsl:mode on-no-match="shallow-copy"/>
	<xsl:param name="prefixes" as="" select=""/>
	
	<?process 8798?>
	<xsl:template match="item[@class eq 'random']" mode="#all">
		<!-- Gather together -->
		<xsl:variable name="list" as="xs:string*" 
			select="
				for $num in 1 to 20 return
					substring($prefixes[$num], 5) => 
					string-join('end' || $num)"/>
		
		<body id="{$list[2]}">
			<text>All prefixes '{$list}' &lt;included.</text>
		</body>
	</xsl:template>
	
	
	
</xsl:stylesheet>