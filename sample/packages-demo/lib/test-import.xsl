<?xml version="1.0" encoding="UTF-8"?>
<xsl:package xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
             xmlns:xs="http://www.w3.org/2001/XMLSchema"
             xmlns:f="namespace-uri"
    exclude-result-prefixes="#all"
    name="com.exmample.vscode.xslt.test"
             version="1.2">

    <xsl:function name="f:new" as="xs:string" visibility="public">
        <xsl:param name="name" as="xs:string"/>
        <xsl:sequence select="'hello' || $name"/>
    </xsl:function>

</xsl:package>
