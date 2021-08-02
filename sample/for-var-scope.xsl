<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet 
	xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
	version="3.0">	
	
	<xsl:variable name="test1" as="item()*" 
		select="
			for $a in 1 return $a, 2
		"/>
	
	<xsl:template match="/" mode="#default">
		<result><xsl:sequence select="$test1"/></result>
	</xsl:template>
	
</xsl:stylesheet>