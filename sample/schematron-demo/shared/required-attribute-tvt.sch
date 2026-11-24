<?xml version="1.0" encoding="UTF-8"?>
<!-- required-attribute.sch, with a text value template - with xsl:expand-text on this file's own root: each file included
     decides for itself. The parameters of an abstract pattern are replaced in text value templates too, e.g. $required
     below, as the extension rewrites them as sch:value-of first -->
<pattern xmlns="http://purl.oclc.org/dsdl/schematron" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xsl:expand-text="yes"
    abstract="true" id="required-attribute">
  <title>A required attribute</title>
  <param name="element"/>
  <param name="required"/>
  <rule context="$element">
    <assert test="normalize-space($required)">The <name/> element needs a value for {'$required'}</assert>
  </rule>
</pattern>
