<?xml version="1.1" encoding="UTF-8"?>
<!-- XML 1.1, for the ESC character of an ANSI color code - as in xdm-view-text.xsl, for xdm:debug-color() -->
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template name="xsl:initial-template">
    <xsl:message select="'&#x1B;[0;32mgreen&#x1B;[0m &lt;text&gt; &amp;'"/>
    <xsl:message><item n="1">with markup</item></xsl:message>
    <out/>
  </xsl:template>
</xsl:stylesheet>
