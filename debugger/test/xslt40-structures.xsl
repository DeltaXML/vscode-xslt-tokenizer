<xsl:stylesheet version="4.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
    exclude-result-prefixes="#all">
  <!-- a JNode tree: a global variable -->
  <xsl:variable name="tree" select="jtree({ 'orders': [ { 'id': 'A-100', 'total': 33.3 }, { 'id': 'B-200', 'total': 17.1 } ] })"/>
  <xsl:template name="xsl:initial-template">
    <out>
      <xsl:for-each select="$tree/orders/*">
        <!-- a JNode: a local variable -->
        <xsl:variable name="order" select="."/>
        <xsl:switch select="string($order/id)">
          <xsl:when test="'A-100'">
            <first id="{$order/id}"/>
          </xsl:when>
          <xsl:otherwise>
            <other id="{$order/id}"/>
          </xsl:otherwise>
        </xsl:switch>
        <xsl:variable name="band" as="xs:string">
          <xsl:select>
            if ($order/total gt 20)
            then 'high'
            else 'low'
          </xsl:select>
        </xsl:variable>
        <band><xsl:value-of select="$band"/></band>
      </xsl:for-each>
    </out>
  </xsl:template>
</xsl:stylesheet>
