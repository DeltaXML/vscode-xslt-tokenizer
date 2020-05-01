<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
				xmlns:xs="http://www.w3.org/2001/XMLSchema"
				xmlns:fn="abc"
				exclude-result-prefixes="#all"
				expand-text="yes"
				version="3.0">


	<xsl:function name="fn:test" as="xs:string">
		<xsl:param name="p1" as="node()"/>
		<xsl:param name="p2" as="node()"/>
		
		<xsl:sequence select="$p1, $p2"/>		
	</xsl:function>
	

	

</xsl:stylesheet>
