<!-- abc -->
<!DOCTYPE xsl:stylesheet [
<!ENTITY doe-lt "&#xE801;">
<!ENTITY doe-amp "&#xE802;">
<!ENTITY doe-gt "&#xE803;">
<!ENTITY doe-apos "&#xE804;">
<!ENTITY doe-quot "&#xE805;">
]>
<xsl:stylesheet  
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:array="http://www.w3.org/2005/xpath-functions/array"
    xmlns:map="http://www.w3.org/2005/xpath-functions/map"
    xmlns:math="http://www.w3.org/2005/xpath-functions/math"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:saxon="http://saxon.sf.net/"
    xmlns:fn="def"
    version="3.0">
    
    <xsl:variable name="va" as="xs:integer" select="2"/>
    <xsl:variable name="v1" as="xs:integer" select="3"/>
    
    <xsl:template match="/" mode="#all">
        <xsl:sequence select="let $a := ($v1, $va) return $a"/>
        
        
    </xsl:template>
   
    
</xsl:stylesheet>