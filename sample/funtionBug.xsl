<xsl:stylesheet  
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:array="http://www.w3.org/2005/xpath-functions/array"
    xmlns:map="http://www.w3.org/2005/xpath-functions/map"
    xmlns:math="http://www.w3.org/2005/xpath-functions/math"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:saxon="http://saxon.sf.net/"
    xmlns:abc="namespace-uri.com"
    xmlns:fn="def"
    version="3.0">
    
    <xsl:import href="functionBugImport.xsl"/>
    
    <xsl:variable name="test" as="xs:int" select="abc:test1('a')"/>     
    
</xsl:stylesheet>