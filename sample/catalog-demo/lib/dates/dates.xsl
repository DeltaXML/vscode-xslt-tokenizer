<?xml version="1.0" encoding="UTF-8"?>
<!-- A date library, imported as http://example.com/xslt/dates.xsl -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:dt="http://example.com/ns/dates"
                exclude-result-prefixes="#all"
                version="3.0">

  <!-- the date as, e.g., 'Wednesday 30 September 2026' -->
  <xsl:function name="dt:long-date" as="xs:string">
    <xsl:param name="date" as="xs:date"/>
    <xsl:sequence select="format-date($date, '[FNn] [D] [MNn] [Y]')"/>
  </xsl:function>

</xsl:stylesheet>
