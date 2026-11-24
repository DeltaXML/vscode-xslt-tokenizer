<pattern xmlns="http://purl.oclc.org/dsdl/schematron" id="codes">
  <rule context="code"><assert test="matches(., '^[A-Z]{2,3}$')">Code <value-of select="."/> must match [A-Z]{2,3}</assert></rule>
</pattern>
