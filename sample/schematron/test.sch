<schema xmlns="http://purl.oclc.org/dsdl/schematron" xmlns:saxon="http://saxon.sf.net/"
        xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <ns prefix="xsl" uri="http://www.w3.org/1999/XSL/Transform" />
  <xsl:include xmlns:xsl="http://www.w3.org/1999/XSL/Transform" href="cals-constraints.xsl" />
  <phase id="context">
    <active pattern="p-context"/>
  </phase>

  <pattern id="p-context">
    <rule context="*:thead">
      <assert role="warning" test="not(exists(*:row/*:entry/@spanname) and exists(*:colspec))">Use of the spanname attribute in a thead (<value-of select="saxon:path()"/>) is not allowed when local colspec elements are defined CALS-T5R1</assert>
    </rule>    
  </pattern>
  
</schema>