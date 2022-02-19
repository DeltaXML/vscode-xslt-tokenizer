<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
																xmlns:xs="http://www.w3.org/2001/XMLSchema"
																version="3.0">
	
	<xsl:template name="tname">
		<xsl:param name="param1" as="xs:string"/>
		<xsl:param name="param2" as="xs:string"/>
		<xsl:sequence select="$param1, $param2"/>
	</xsl:template>
	
	<xsl:function name="xs:fname">
		<xsl:call-template name="tname">
			<xsl:with-param name="param1" as="xs:string" select="'one'"/>
			<xsl:with-param name="param2" as="xs:string" select="'two'"/>
		</xsl:call-template>
	</xsl:function>
	
</xsl:stylesheet>