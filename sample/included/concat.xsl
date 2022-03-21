<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:log="com.test"
                extension-element-prefixes="log"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="4.0">
  
  <xsl:template match="/*">
    <xsl:variable name="greeting" as="xs:string" select="'phil'"/>
    <xsl:variable name="greetingList" as="xs:string+" select="'phil', 'john'"/>
    <root>      
      <log:message message="hello world"/>
      <log:message message="{$greeting}"/>
      <log:messages message="$greetingList"/>
    </root>
  </xsl:template>
  
  <xsl:template name="log:message">
    <xsl:param name="message" as="xs:string"/>
    <p><xsl:value-of select="$message"/></p>
  </xsl:template>
  
  <xsl:template name="log:messages">
    <xsl:param name="message" as="xs:string+"/>
    <xsl:for-each select="$message">
      <p><xsl:value-of select="$message"/></p>
    </xsl:for-each>
  </xsl:template>
  
</xsl:stylesheet>