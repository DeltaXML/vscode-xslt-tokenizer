<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    
    <xsl:output method="xml" indent="yes"/>  
    <xsl:mode on-no-match="shallow-copy"/>
    <xsl:variable name="a" as="xs:string" select="''"/>
    <xsl:variable name="b" as="xs:string" select="''"/>
    
    <xsl:template match="/" mode="#all">
        <xsl:copy>
            <xsl:apply-templates select="." mode="#current"/>
            <xsl:sequence select="
                let $tuples := $a,
                    $c := 
                    for $tuple in $tuples 
                    return 
                        if($b) then $tuple else '',
                            $pos := $c
                return 
                    $pos"/>
        </xsl:copy>
    </xsl:template>

    

</xsl:stylesheet>