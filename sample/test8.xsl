<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">

    <xsl:variable name="myVar" as="xs:string" select="'test'"/>
    

    <xsl:template match="@*" mode="#all">
        <xsl:sequence select="2 + "/>
        
    </xsl:template>

    

</xsl:stylesheet>