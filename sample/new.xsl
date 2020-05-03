<xsl:template xmlns:xsl="abc">

    <xsl:param name="od" as="xs:integer" select="$c"/>

   
    <xsl:variable name="d" as="xs:integer" select="$c"/>
    
    <xsl:variable name="e" as="xs:integer" select="$c"/>
        
    <xsl:variable name="c" as="xs:integer" select="5">
        <abc>
        <xsl:sequence select="$d"/>
        </abc>
    </xsl:variable>
            
</xsl:template>
