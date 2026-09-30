<?xml version="1.0" encoding="UTF-8"?>
<!--
  The top-level stylesheet: it imports the two libraries by their catalog names,
  not by file paths. With the XSLT.resources.catalog setting pointing at
  catalog.xml, the extension resolves these hrefs through the catalogs - so the
  functions and variable below are known, and Ctrl/Cmd+click on an href opens the
  library file. Without the setting, the imports aren't resolved, and the
  references to str:shout, dt:long-date and $str:separator are reported.
-->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:str="http://example.com/ns/strings"
                xmlns:dt="http://example.com/ns/dates"
                exclude-result-prefixes="#all"
                version="3.0">

  <xsl:import href="http://example.com/xslt/strings.xsl"/>
  <xsl:import href="http://example.com/xslt/dates.xsl"/>

  <xsl:output method="text"/>

  <xsl:template name="xsl:initial-template">
    <xsl:sequence select="str:shout('catalogs work') || $str:separator || dt:long-date(current-date())"/>
  </xsl:template>

</xsl:stylesheet>
