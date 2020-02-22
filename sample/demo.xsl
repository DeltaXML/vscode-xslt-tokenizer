<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    version="3.0"
    expand-text="yes">

    <!-- comment --

    <?myproc processing instruction?>
 
 <xsl:template match="TITLE">
<h1>{for $a in 1 to 20 return descendant::NAME[@id eq 'tqs'] || $a}</h1>
 </xsl:template>
 
 <xsl:template match="PERSONA[count(tokenize(., ',') = 2]">
   <para><b>{substring-before(., ',')}</b>: {substring-after(., ',')}</para>
   some test here &lt; and again
 </xsl:template> 

</xsl:stylesheet>