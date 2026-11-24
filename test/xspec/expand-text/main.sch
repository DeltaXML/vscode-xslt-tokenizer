<schema xmlns="http://purl.oclc.org/dsdl/schematron" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" queryBinding="xslt3" xsl:expand-text="yes">
  <include href="lib/library.sch"/>
  <include href="lib/tvt-pattern.sch"/>
  <pattern id="items"><rule context="item"><assert test="@n">Item {@id} has no n</assert></rule></pattern>
</schema>
