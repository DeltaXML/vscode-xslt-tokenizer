<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" 
                version="3.0"
                expand-text="yes">
  
  <!-- xml comment -->
  <?pi height < 4: width > 28 ?>
  
  <xsl:variable name="cities" as="map(*)" select="
    map {
      'us': ['New York', 'Washington'],
      'uk': 'london',
      'eu': map {
        'france': 'Paris',
        'germany': 'Berlin'
      }
    }"/>
  
  <xsl:template match="TITLE[@id eq 'king'] | SUBTITLE">
    <xsl:variable name="result" as="" select="for $a in 1 to 20 return 'a' || descendant::NAME[@id eq 'tqs'] || $a"/>
    <h1>{$result}</h1>
    <para>text value templates {count($result)} need special attention {$cities?uk}</para>
    <para>
      cdata <![CDATA[can have {$tvt || '<content>' || $q < 58.7} <also>]]> 
    </para>
    <div name="section-{$result?eu?france}">
      text nodes <![CDATA[have <b>cdata</b> tags]]>
      entity references &lt;need&gt; special care
    </div>
    
    <heading name="simple attributes"/>
  </xsl:template>
  
</xsl:stylesheet>