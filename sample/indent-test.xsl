<xsl:element name="{name($row-or-element)}" namespace="{namespace-uri($row-or-element)}">
  <xsl:apply-templates select="$row-or-element/@*" mode="#default"/>
  <xsl:for-each select="
                $morerows-versions">
    <xsl:if test="$morerows[index-of($morerows-versions, current())] gt 1">
      <xsl:attribute name="{concat('html:overlapped-',string-join(tokenize(lower-case(current()),'='),'-'))}" select="'true'"/>
    </xsl:if>
  </xsl:for-each>
  <xsl:apply-templates select="$row-or-element/node()" mode="overlap"/>
</xsl:element>