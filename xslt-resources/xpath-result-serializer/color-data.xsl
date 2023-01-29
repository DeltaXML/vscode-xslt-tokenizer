<?xml version="1.1" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="3.0">
    
    <xsl:variable name="LF" as="xs:string" select="'&#10;'"/>
    <xsl:variable name="RESET" as="xs:string" select="'&#x1B;[0m'"/>
    
    <xsl:variable name="COLOR" as="xs:string" select="'heloo'"/>
    <xsl:variable name="BLACK" as="xs:string" select="'&#x1B;[0;30m'"/>
    <xsl:variable name="RED" as="xs:string" select="'&#x1B;[0;31m'"/>
    <xsl:variable name="GREEN" as="xs:string" select="'&#x1B;[0;32m'"/>
    <xsl:variable name="YELLOW" as="xs:string" select="'&#x1B;[0;33m'"/>
    <xsl:variable name="BLUE" as="xs:string" select="'&#x1B;[0;34m'"/>
    <xsl:variable name="MAGENTA" as="xs:string" select="'&#x1B;[0;35m'"/>
    <xsl:variable name="CYAN" as="xs:string" select="'&#x1B;[0;36m'"/>
    <xsl:variable name="WHITE" as="xs:string" select="'&#x1B;[0;37m'"/>
    
    <!-- Bold -->
    <xsl:variable name="BLACK_BOLD" as="xs:string" select="'&#x1B;[1;30m'"/>
    <xsl:variable name="RED_BOLD" as="xs:string" select="'&#x1B;[1;31m'"/>
    <xsl:variable name="GREEN_BOLD" as="xs:string" select="'&#x1B;[1;32m'"/>
    <xsl:variable name="YELLOW_BOLD" as="xs:string" select="'&#x1B;[1;33m'"/>
    <xsl:variable name="BLUE_BOLD" as="xs:string" select="'&#x1B;[1;34m'"/>
    <xsl:variable name="MAGENTA_BOLD" as="xs:string" select="'&#x1B;[1;35m'"/>
    <xsl:variable name="CYAN_BOLD" as="xs:string" select="'&#x1B;[1;36m'"/>
    <xsl:variable name="WHITE_BOLD" as="xs:string" select="'&#x1B;[1;37m'"/>
    
    <!-- Underline -->
    <xsl:variable name="BLACK_UNDERLINED" as="xs:string" select="'&#x1B;[4;30m'"/>
    <xsl:variable name="RED_UNDERLINED" as="xs:string" select="'&#x1B;[4;31m'"/>
    <xsl:variable name="GREEN_UNDERLINED" as="xs:string" select="'&#x1B;[4;32m'"/>
    <xsl:variable name="YELLOW_UNDERLINED" as="xs:string" select="'&#x1B;[4;33m'"/>
    <xsl:variable name="BLUE_UNDERLINED" as="xs:string" select="'&#x1B;[4;34m'"/>
    <xsl:variable name="MAGENTA_UNDERLINED" as="xs:string" select="'&#x1B;[4;35m'"/>
    <xsl:variable name="CYAN_UNDERLINED" as="xs:string" select="'&#x1B;[4;36m'"/>
    <xsl:variable name="WHITE_UNDERLINED" as="xs:string" select="'&#x1B;[4;37m'"/>
    
    <!-- Background -->
    <xsl:variable name="BLACK_BACKGROUND" as="xs:string" select="'&#x1B;[40m'"/>
    <xsl:variable name="RED_BACKGROUND" as="xs:string" select="'&#x1B;[41m'"/>
    <xsl:variable name="GREEN_BACKGROUND" as="xs:string" select="'&#x1B;[42m'"/>
    <xsl:variable name="YELLOW_BACKGROUND" as="xs:string" select="'&#x1B;[43m'"/>
    <xsl:variable name="BLUE_BACKGROUND" as="xs:string" select="'&#x1B;[44m'"/>
    <xsl:variable name="MAGENTA_BACKGROUND" as="xs:string" select="'&#x1B;[45m'"/>
    <xsl:variable name="CYAN_BACKGROUND" as="xs:string" select="'&#x1B;[46m'"/>
    <xsl:variable name="WHITE_BACKGROUND" as="xs:string" select="'&#x1B;[47m'"/>
    
    <!-- High Intensity -->
    <xsl:variable name="BLACK_BRIGHT" as="xs:string" select="'&#x1B;[0;90m'"/>
    <xsl:variable name="RED_BRIGHT" as="xs:string" select="'&#x1B;[0;91m'"/>
    <xsl:variable name="GREEN_BRIGHT" as="xs:string" select="'&#x1B;[0;92m'"/>
    <xsl:variable name="YELLOW_BRIGHT" as="xs:string" select="'&#x1B;[0;93m'"/>
    <xsl:variable name="BLUE_BRIGHT" as="xs:string" select="'&#x1B;[0;94m'"/>
    <xsl:variable name="MAGENTA_BRIGHT" as="xs:string" select="'&#x1B;[0;95m'"/>
    <xsl:variable name="CYAN_BRIGHT" as="xs:string" select="'&#x1B;[0;96m'"/>
    <xsl:variable name="WHITE_BRIGHT" as="xs:string" select="'&#x1B;[0;97m'"/>
    
    <!-- Bold High Intensity -->
    <xsl:variable name="BLACK_BOLD_BRIGHT" as="xs:string" select="'&#x1B;[1;90m'"/>
    <xsl:variable name="RED_BOLD_BRIGHT" as="xs:string" select="'&#x1B;[1;91m'"/>
    <xsl:variable name="GREEN_BOLD_BRIGHT" as="xs:string" select="'&#x1B;[1;92m'"/>
    <xsl:variable name="YELLOW_BOLD_BRIGHT" as="xs:string" select="'&#x1B;[1;93m'"/>
    <xsl:variable name="BLUE_BOLD_BRIGHT" as="xs:string" select="'&#x1B;[1;94m'"/>
    <xsl:variable name="MAGENTA_BOLD_BRIGHT" as="xs:string" select="'&#x1B;[1;95m'"/>
    <xsl:variable name="CYAN_BOLD_BRIGHT" as="xs:string" select="'&#x1B;[1;96m'"/>
    <xsl:variable name="WHITE_BOLD_BRIGHT" as="xs:string" select="'&#x1B;[1;97m'"/>
    
    <!-- High Intensity backgrounds -->
    <xsl:variable name="BLACK_BACKGROUND_BRIGHT" as="xs:string" select="'&#x1B;[0;100m'"/>
    <xsl:variable name="RED_BACKGROUND_BRIGHT" as="xs:string" select="'&#x1B;[0;101m'"/>
    <xsl:variable name="GREEN_BACKGROUND_BRIGHT" as="xs:string" select="'&#x1B;[0;102m'"/>
    <xsl:variable name="YELLOW_BACKGROUND_BRIGHT" as="xs:string" select="'&#x1B;[0;103m'"/>
    <xsl:variable name="BLUE_BACKGROUND_BRIGHT" as="xs:string" select="'&#x1B;[0;104m'"/>
    <xsl:variable name="MAGENTA_BACKGROUND_BRIGHT" as="xs:string" select="'&#x1B;[0;105m'"/>
    <xsl:variable name="CYAN_BACKGROUND_BRIGHT" as="xs:string" select="'&#x1B;[0;106m'"/>
    <xsl:variable name="WHITE_BACKGROUND_BRIGHT" as="xs:string" select="'&#x1B;[0;107m'"/>
    
</xsl:stylesheet>