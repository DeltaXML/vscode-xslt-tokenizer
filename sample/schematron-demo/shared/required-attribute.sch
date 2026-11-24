<?xml version="1.0" encoding="UTF-8"?>
<!-- An abstract pattern, included by order-rules.sch with sch:include: each pattern with is-a="required-attribute"
     gives its parameters values, which replace $element and $required as text -->
<pattern xmlns="http://purl.oclc.org/dsdl/schematron" abstract="true" id="required-attribute">
  <title>A required attribute</title>
  <param name="element"/>
  <param name="required"/>
  <rule context="$element">
    <assert test="normalize-space($required)">The <name/> element needs a value for <value-of select="'$required'"/></assert>
  </rule>
</pattern>
