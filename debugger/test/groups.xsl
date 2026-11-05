<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="/">
    <out>
      <xsl:for-each-group select="items/item" group-by="@n mod 2">
        <group key="{current-grouping-key()}" size="{count(current-group())}"/>
      </xsl:for-each-group>
      <xsl:analyze-string select="string-join(items/item/(local-name() || @n), ' ')" regex="([a-z]+)(\d)">
        <xsl:matching-substring>
          <m><xsl:value-of select="regex-group(2)"/></m>
        </xsl:matching-substring>
      </xsl:analyze-string>
    </out>
  </xsl:template>
</xsl:stylesheet>
