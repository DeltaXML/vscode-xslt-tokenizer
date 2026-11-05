<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
    exclude-result-prefixes="#all">
  <xsl:template match="/">
    <out>
      <xsl:for-each select="items/item">
        <xsl:sort select="
          xs:integer(@n)
            * -1"/>
        <for-each n="{@n}"/>
      </xsl:for-each>
      <xsl:variable name="sorted" as="element()*">
        <xsl:perform-sort select="items/item">
          <xsl:sort select="
            string(@n)" order="descending"/>
        </xsl:perform-sort>
      </xsl:variable>
      <perform-sort><xsl:value-of select="$sorted/@n"/></perform-sort>
      <xsl:apply-templates select="items/item">
        <xsl:sort select="@n" order="descending"/>
      </xsl:apply-templates>
    </out>
  </xsl:template>
  <xsl:template match="item">
    <applied n="{@n}"/>
  </xsl:template>
</xsl:stylesheet>
