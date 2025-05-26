<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:fn="namespace-uri"
                xmlns:ct="com.test"
                version="3.0">
  
  <!-- inform script that generates unit-test data to use 'as' attribute -->
  <?test-attribute select?>
  <xsl:variable name="test1" select="'one' || 'two'"/>
  
</xsl:stylesheet>