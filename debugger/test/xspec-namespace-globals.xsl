<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0" expand-text="yes"
    xmlns:x="http://www.jenitennison.com/xslt/xspec" xmlns:impl="urn:x-xspec:compile:impl">
  <!-- globals in XSpec's namespaces, as in XSpec's compiler: shown when it's debugged, though not in an XSpec test run -->
  <xsl:variable name="x:version" select="'1'"/>
  <xsl:variable name="impl:count" select="2"/>
  <xsl:variable name="other" select="3"/>
  <xsl:template name="xsl:initial-template">
    <out>{$x:version}{$impl:count}{$other}</out>
  </xsl:template>
</xsl:stylesheet>
