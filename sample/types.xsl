<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">"

    
    <xsl:variable name="test" as="" select="count(22)"/>
    <xsl:variable name="test2" as="" select="abc/jkl/def/ghi/jkl[@name and @id and @myatt]"/>

    <xsl:template match="" mode="#all">
        <xsl:copy>
            <xsl:apply-templates select="" mode="#current"/>
        </xsl:copy>
    </xsl:template>

    

</xsl:stylesheet>