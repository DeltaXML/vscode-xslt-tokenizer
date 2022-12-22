<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:fn="abc"
    exclude-result-prefixes="xs"
    version="2.0">
    
    <xsl:variable name="a" select="function() {'a'}"/>
  
    <xsl:variable name="new" select="
        /*, 
        /(),
        / => count(),
        /(*),
        /abc,  
        /@abc,
        /child::*, 
        /base-uri(), 
        /$a()
"/>

</xsl:stylesheet>