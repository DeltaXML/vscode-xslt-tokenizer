<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:map="http://www.w3.org/2005/xpath-functions/map"
                xmlns:math="http://www.w3.org/2005/xpath-functions/math"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">
  
  <xsl:output method="xml" indent="yes"/>
  <xsl:mode on-no-match="shallow-copy"/>
  
  <xsl:template match="/*" mode="#all">
    <xsl:merge>
      <xsl:merge-source name="master" 
        for-each-source="'master.xml'"
        streamable="yes"
        select="/events/event">
        <xsl:merge-key select="@key"/>
      </xsl:merge-source>
      <xsl:merge-source name="updates" 
        for-each-source="uri-collection('updates')"
        streamable="yes"
        select="/events/event-change">
        <xsl:merge-key select="@affected-key"/>
      </xsl:merge-source>
      <xsl:merge-action>
        <xsl:choose>
          <xsl:when test="empty(current-merge-group())">
            <xsl:message>
              Error: update is present with no matching master record!
            </xsl:message>
          </xsl:when>
          <xsl:when test="empty(current-merge-group('updates'))">
            <xsl:copy-of select="current-merge-group('master')"/>
          </xsl:when>
          <xsl:when test="count(current-merge-group('updates')) = 1">
            <xsl:copy-of select="current-merge-group('updates')"/>
          </xsl:when>
          <xsl:otherwise>
            <xsl:message>
              Conflict: multiple updates for the same master record!
            </xsl:message>
          </xsl:otherwise>
        </xsl:choose>
      </xsl:merge-action>
    </xsl:merge>
  </xsl:template>
  
  
  
</xsl:stylesheet>