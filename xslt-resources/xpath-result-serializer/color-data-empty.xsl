<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="3.0">
    
    <xsl:variable name="LF" as="xs:string" select="'&#10;'"/>
    <xsl:variable name="RESET" as="xs:string" select="''"/>
    
    <xsl:variable name="BLACK" as="xs:string" select="''"/>
    <xsl:variable name="RED" as="xs:string" select="''"/>
    <xsl:variable name="GREEN" as="xs:string" select="''"/>
    <xsl:variable name="YELLOW" as="xs:string" select="''"/>
    <xsl:variable name="BLUE" as="xs:string" select="''"/>
    <xsl:variable name="MAGENTA" as="xs:string" select="''"/>
    <xsl:variable name="CYAN" as="xs:string" select="''"/>
    <xsl:variable name="WHITE" as="xs:string" select="''"/>
    
    <!-- Bold -->
    <xsl:variable name="BLACK_BOLD" as="xs:string" select="''"/>
    <xsl:variable name="RED_BOLD" as="xs:string" select="''"/>
    <xsl:variable name="GREEN_BOLD" as="xs:string" select="''"/>
    <xsl:variable name="YELLOW_BOLD" as="xs:string" select="''"/>
    <xsl:variable name="BLUE_BOLD" as="xs:string" select="''"/>
    <xsl:variable name="MAGENTA_BOLD" as="xs:string" select="''"/>
    <xsl:variable name="CYAN_BOLD" as="xs:string" select="''"/>
    <xsl:variable name="WHITE_BOLD" as="xs:string" select="''"/>
    
    <!-- Underline -->
    <xsl:variable name="BLACK_UNDERLINED" as="xs:string" select="''"/>
    <xsl:variable name="RED_UNDERLINED" as="xs:string" select="''"/>
    <xsl:variable name="GREEN_UNDERLINED" as="xs:string" select="''"/>
    <xsl:variable name="YELLOW_UNDERLINED" as="xs:string" select="''"/>
    <xsl:variable name="BLUE_UNDERLINED" as="xs:string" select="''"/>
    <xsl:variable name="MAGENTA_UNDERLINED" as="xs:string" select="''"/>
    <xsl:variable name="CYAN_UNDERLINED" as="xs:string" select="''"/>
    <xsl:variable name="WHITE_UNDERLINED" as="xs:string" select="''"/>
    
    <!-- Background -->
    <xsl:variable name="BLACK_BACKGROUND" as="xs:string" select="''"/>
    <xsl:variable name="RED_BACKGROUND" as="xs:string" select="''"/>
    <xsl:variable name="GREEN_BACKGROUND" as="xs:string" select="''"/>
    <xsl:variable name="YELLOW_BACKGROUND" as="xs:string" select="''"/>
    <xsl:variable name="BLUE_BACKGROUND" as="xs:string" select="''"/>
    <xsl:variable name="MAGENTA_BACKGROUND" as="xs:string" select="''"/>
    <xsl:variable name="CYAN_BACKGROUND" as="xs:string" select="''"/>
    <xsl:variable name="WHITE_BACKGROUND" as="xs:string" select="''"/>
    
    <!-- High Intensity -->
    <xsl:variable name="BLACK_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="RED_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="GREEN_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="YELLOW_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="BLUE_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="MAGENTA_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="CYAN_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="WHITE_BRIGHT" as="xs:string" select="''"/>
    
    <!-- Bold High Intensity -->
    <xsl:variable name="BLACK_BOLD_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="RED_BOLD_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="GREEN_BOLD_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="YELLOW_BOLD_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="BLUE_BOLD_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="MAGENTA_BOLD_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="CYAN_BOLD_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="WHITE_BOLD_BRIGHT" as="xs:string" select="''"/>
    
    <!-- High Intensity backgrounds -->
    <xsl:variable name="BLACK_BACKGROUND_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="RED_BACKGROUND_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="GREEN_BACKGROUND_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="YELLOW_BACKGROUND_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="BLUE_BACKGROUND_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="MAGENTA_BACKGROUND_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="CYAN_BACKGROUND_BRIGHT" as="xs:string" select="''"/>
    <xsl:variable name="WHITE_BACKGROUND_BRIGHT" as="xs:string" select="''"/>
    
</xsl:stylesheet>