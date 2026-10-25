<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
    exclude-result-prefixes="#all">
  <xsl:template match="/">
    <out>
      <xsl:analyze-string select="
        string-join(items/item/@n, '-')
          || '-x'" regex="([0-9])">
        <xsl:matching-substring>
          <d><xsl:value-of select="regex-group(1)"/></d>
        </xsl:matching-substring>
        <xsl:non-matching-substring>
          <s><xsl:value-of select="."/></s>
        </xsl:non-matching-substring>
      </xsl:analyze-string>
      <xsl:variable name="letters" select="'[a-z]+'"/>
      <xsl:analyze-string select="string(items/item[2])" regex="{$letters}">
        <xsl:matching-substring>
          <w><xsl:value-of select="."/></w>
        </xsl:matching-substring>
      </xsl:analyze-string>
    </out>
  </xsl:template>
</xsl:stylesheet>
