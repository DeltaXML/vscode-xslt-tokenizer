<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math"
                xmlns:deltaxml="test"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
  
  <xsl:template match="*[deltaxml:format-start][@deltaxml:deltaV2='A!=B']">
    <xsl:apply-templates select="@*"/>
    <span class="delete_version" deltaxml:deltaV2="A">
      <xsl:call-template name="group">
        <xsl:with-param name="sequence" select="node()[not(self::deltaxml:format-start[@deltaxml:deltaV2='B'] or self::deltaxml:format-end[@deltaxml:deltaV2='B'] or self::deltaxml:element)]"/>
        <xsl:with-param name="version" select="'A'"/>
      </xsl:call-template>
    </span>
    <span class="add_version" deltaxml:deltaV2="B">
      <xsl:call-template name="group">
        <xsl:with-param name="sequence" select="node()[not(self::deltaxml:format-start[@deltaxml:deltaV2='A'] or self::deltaxml:format-end[@deltaxml:deltaV2='A'] or self::deltaxml:element)]"/>
        <xsl:with-param name="version" select="'B'"/>
      </xsl:call-template>
    </span>
    <span class="modify_version" deltaxml:deltaV2="A!=B">
      <xsl:call-template name="group">
        <xsl:with-param name="sequence" select="node()[not(self::deltaxml:format-start[@deltaxml:deltaV2='A'] or self::deltaxml:format-end[@deltaxml:deltaV2='A'] or self::deltaxml:element)]"/>
        <xsl:with-param name="version" select="'B'"/>
      </xsl:call-template>
    </span>
  </xsl:template>
  
  <xsl:template name="group" as="">
    <xsl:param name="sequence" as="" select="1"/>
    <xsl:param name="version" as="" select="2"/>
  </xsl:template>
  
  
  
</xsl:stylesheet>