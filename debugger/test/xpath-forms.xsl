<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:f="urn:f" xmlns:map="http://www.w3.org/2005/xpath-functions/map" exclude-result-prefixes="#all">
  <xsl:template match="/">
    <out>
      <xsl:variable name="flwor" select="
        for $i in items/item
        return
          let $n := xs:integer($i/@n)
          return
            if ($n gt 1)
            then $n * 10
            else ()" xmlns:xs="http://www.w3.org/2001/XMLSchema"/>
      <flwor><xsl:value-of select="$flwor"/></flwor>
      <xsl:variable name="choice" select="
        if (count(items/item) &gt; 2)
        then
          'many'
        else
          'few'"/>
      <choice><xsl:value-of select="$choice"/></choice>
      <xsl:variable name="path" select="
        items/item
          [@n != '2']
          /@n"/>
      <path><xsl:value-of select="$path"/></path>
      <xsl:variable name="m" select="
        map {
          'a': f:twice(1),
          'b': [1, 2]
        }"/>
      <map><xsl:value-of select="map:keys($m) => sort() => string-join(',')"/></map>
      <xsl:variable name="q" select="
        some $i in items/item
        satisfies
          $i/@n = '3'"/>
      <q><xsl:value-of select="$q"/></q>
      <xsl:variable name="s" select="
        concat(
          upper-case('a'),
          '&lt;',
          string-join(
            for $c in ('x', 'y') return $c,
            '-'
          )
        )"/>
      <s><xsl:value-of select="$s"/></s>
      <xsl:for-each-group select="items/item" group-by="@n mod 2">
        <xsl:variable name="g" select="
          string(current-grouping-key())
          || ':'
          || count(current-group())
          || ':'
          || name(current())"/>
        <g><xsl:value-of select="$g"/></g>
      </xsl:for-each-group>
    </out>
  </xsl:template>
  <xsl:function name="f:twice">
    <xsl:param name="x"/>
    <xsl:sequence select="$x * 2"/>
  </xsl:function>
</xsl:stylesheet>
