<pattern xmlns="http://purl.oclc.org/dsdl/schematron" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xsl:expand-text="yes" id="names">
  <rule context="name"><assert test="normalize-space()">The {local-name(..)} has an empty name</assert></rule>
</pattern>
