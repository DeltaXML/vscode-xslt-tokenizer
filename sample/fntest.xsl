<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
								xmlns:xs="http://www.w3.org/2001/XMLSchema"
								xmlns:array="http://www.w3.org/2005/xpath-functions/array"
								xmlns:map="http://www.w3.org/2005/xpath-functions/map"
								xmlns:math="http://www.w3.org/2005/xpath-functions/math"
								exclude-result-prefixes="#all"
								expand-text="yes"
								version="3.0">
	
	<xsl:template match="/*" mode="#default">
		<xsl:variable name="fn" as="map(*)" select="
			map {'abc':'new'}"/>
		<xsl:sequence select="$fn"/>
	</xsl:template>
</xsl:stylesheet>