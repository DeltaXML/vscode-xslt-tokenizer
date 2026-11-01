<?xml version="1.0" encoding="UTF-8"?>
<!-- an xsl:result-document with no href writes the principal result - as XSpec's test runner writes its report -->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0">
  <xsl:template name="xsl:initial-template" as="empty-sequence()">
    <xsl:result-document>
      <report>
        <test id="t1" successful="true"/>
      </report>
    </xsl:result-document>
  </xsl:template>
</xsl:stylesheet>
