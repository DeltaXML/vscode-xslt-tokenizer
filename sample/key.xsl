<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  exclude-result-prefixes="xs"
  version="2.0">
  
  <xsl:key name="idkey" match="div" use="@id"/>

<xsl:attribute-set name="field-attributes" 
    visibility="public">
    <xsl:attribute name="quoted" 
      select="if (starts-with(., '')) 
      then 'yes' 
      else 'no'"/>
  </xsl:attribute-set>
  
  <xsl:accumulator name="a" initial-value="0">
    <xsl:accumulator-rule match="section" select="$value + 1"/>
  </xsl:accumulator>
  
  <xsl:template match="bibref">
    <xsl:variable name="name" select="."/>
	<field xsl:use-attribute-sets="field-attributes">test</field>
    <xsl:apply-templates select="document('bib.xml')/key('idkey',$name)"/>
  </xsl:template>
  
</xsl:stylesheet>