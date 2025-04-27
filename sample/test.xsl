<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                expand-text="yes"
                version="3.0">
    
    <xsl:template match="/*" mode="#all">
        <root>
            <xsl:sequence select="
                let $a := trace(/title/child::header/@class),
                    $b := trace(2 + 4,'b')
                return ($a, $b)"/>
        </root>
    </xsl:template>
    
</xsl:stylesheet>