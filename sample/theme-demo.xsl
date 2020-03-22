<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="3.0"
                expand-text="yes">
  
  <!-- xml comment -->
  <?pi height < 4: width > 28 ?>
  
  <avt-sample name="section-{$qrt} block-{$wnt}">
    text nodes <![CDATA[have <b>cdata</b> tags]]>
    entity references &lt;need&gt; special care
  </avt-sample>
  
  <non-avt name="simple attributes"/>
  
  <xsl:template match="TITLE[@id eq 'king'] | SUBTITLE">
    <h1>{for $a in 1 to 20 return descendant::NAME[@id eq 'tqs'] || $a}</h1>
    <p>text value templates {count($desc)} need special attention</p>
    <p>
      cdata <![CDATA[can have {$tvt || '<content>' || $q < 58.7} <also>]]> 
    </p>
  </xsl:template>
  
</xsl:stylesheet>