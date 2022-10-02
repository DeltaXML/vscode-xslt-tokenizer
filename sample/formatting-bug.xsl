<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
    
    <xsl:template match="item[@class eq 'random']" mode="#all">
        <xsl:variable name="list" as="xs:string*" 
            select="
                for $num in 1 to 20 return
                    substring($prefixes[$num], 5) =>  
                    string-join('end' || $num)"/>
        
        <body id="{$list[2]}">
            <text class="this&lt;take&gt;on things">All prefixes '{$list}' &lt;included.</text>
            <![CDATA[Some CDATA content]]>
        </body>
        <xsl:sequence select="/abc[@new eq 'test']/def/parent::taylor"/>
    </xsl:template>
    
    
    
</xsl:stylesheet>