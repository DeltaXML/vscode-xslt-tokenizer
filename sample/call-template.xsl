<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
																xmlns:xs="http://www.w3.org/2001/XMLSchema"
																version="3.0">
	
	<xsl:import href="name-template.xsl"/>
	
	<xsl:function name="xs:fname">
		<xsl:call-template name="tnamePlus">
			<xsl:with-param name="param1plusSave" as="xs:string" select="'one'"/>
			<xsl:with-param name="param2new" as="xs:string" select="'two'"/>
		</xsl:call-template>
	</xsl:function>
	
</xsl:stylesheet>