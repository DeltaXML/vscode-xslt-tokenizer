<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">

    <xsl:output method="xml" indent="yes"/>  
    <xsl:mode on-no-match="shallow-copy"/>
    
    <xsl:param name="varP" as="xs:integer" select="25 + 8"/>   
    
    
    <xsl:variable name="var1" as="xs:integer" select="self::"/>   
    <xsl:variable name="var2" as="xs:integer" select="$var1"/>

    <xsl:template match="book" mode="#all">
        <xsl:variable name="var2" as="xs:integer"
            select="let $var2 := 25 return $var2 + $varP"/>
        <book>
            this is better
        </book>
        <nest>
            <nest>
                <nest>
                    abcd
                </nest>
            </nest>
        </nest>
        <xsl:copy>
            <xsl:apply-templates select="$var2, $var2" mode="#current"/>
            <xsl:sequence select="/alpha/bravo[@delta]/charlie[@echo]/final"/>
            
        </xsl:copy>
    </xsl:template>

</xsl:stylesheet>
