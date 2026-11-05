<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:err="http://www.w3.org/2005/xqt-errors" exclude-result-prefixes="#all">
  <xsl:template match="/">
    <out>
      <xsl:for-each select="items/item">
        <num>
          <xsl:number value="
            xs:integer(@n)
              * 2" format="1"/>
        </num>
        <pos><xsl:number select="." count="item" level="single"/></pos>
      </xsl:for-each>
      <xsl:try select="
        xs:integer(items/item[1]/@n)
          idiv 0">
        <xsl:catch errors="*" select="
          'caught: '
            || $err:code"/>
      </xsl:try>
      <xsl:assert test="
        count(items/item)
          eq 3" error-code="Q{}A1"/>
      <xsl:iterate select="items/item">
        <xsl:choose>
          <xsl:when test="@n = 2">
            <xsl:break select="
              'broke at '
                || @n"/>
          </xsl:when>
          <xsl:otherwise>
            <i n="{@n}"/>
          </xsl:otherwise>
        </xsl:choose>
      </xsl:iterate>
    </out>
  </xsl:template>
</xsl:stylesheet>
