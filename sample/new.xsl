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
    
<!--     <xsl:include href="included1.xsl"/>
    <xsl:import href="features/included2.xsl"/> -->
    
    <xsl:use-package name="example.com.package1"/>
    <xsl:use-package name="example.com.package2"/>
    <xsl:use-package name="example.com.package4"/>
   
   
    <xsl:param name="p1" as="xs:integer" select="1"/>

    <xsl:variable name="va" as="xs:integer" select="2"/>
    <xsl:variable name="v1" as="xs:integer" select="$inc1p1"/>
    <xsl:variable name="v2" as="xs:integer" select="$inc2p1"/>
    <xsl:variable name="v3" as="xs:integer" select="$inc3p1"/>
    <xsl:variable name="v4" as="xs:integer" select="$inc4p1"/>
    <xsl:variable name="v5" as="xs:integer" select="$inc5p1"/>
    <xsl:variable name="v6" as="xs:integer" select="$inc6p1"/>
    
    <xsl:template match="/" mode="#all">
        <xsl:sequence select="let $a := ($v1, $va) return $a"/>
        
        <xsl:copy>
            <xsl:sequence select="map:keys(2)"/>
            <xsl:sequence select="math:pow(2,3)"/>
            <xsl:sequence select="saxon:any(2,3)"/>
            <xsl:sequence select="['a', 'b', 'c'] => array:get(2)"/>
            <xsl:sequence select="xs:integer('a')"/>   
        </xsl:copy>
        
    </xsl:template>

    <xsl:function name="fn:name" as="xs:string">
        <xsl:param name="fp1" as="node()"/>
        <xsl:sequence select="'test'"/>
    </xsl:function>       
                
</xsl:stylesheet>
