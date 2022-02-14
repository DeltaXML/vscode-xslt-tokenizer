<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                version="3.0">
  <xsl:import href="rename2.xsl"/>

  <xsl:variable name="var1" as="xs:integer" select="2"/>
  <xsl:variable name="var2" as="xs:integer" select="$var1"/>
</xsl:stylesheet>