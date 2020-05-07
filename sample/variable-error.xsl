<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                exclude-result-prefixes="#all"
                expand-text="yes"
                version="3.0">

  <xsl:output method="xml" indent="yes"/>  
  <xsl:mode on-no-match="shallow-copy"/>
  <xsl:variable name="original-positions-string" as="" select=""/>
  <xsl:variable name="position-label" as="" select=""/>
  <xsl:variable name="item" as="" select=""/>
  

  <xsl:template match="" mode="#all">
    <xsl:copy>
      <xsl:apply-templates select="" mode="#current"/>
      <xsl:sequence select="
        let $tuples := tokenize($original-positions-string, ','), (: Replace this by use of analyze-string :)
          $posInSequenceOfEmptyString := 
          for $tuple in $tuples 
          return 
            if(normalize-space(tokenize($tuple, '=')[1]) = $position-label) then 
              tokenize($tuple, '=')[2] 
            else '' ,
              $pos := string-join($posInSequenceOfEmptyString)
        return 
          if(not(number($pos))) then (: XPath has no way of outputing a warning message so we have to call an xslt function which does. That functiuon won't be called unless it does something that needs to be evaluated. So Create an ignored vairable which we test and then alwasy return the same result:)
            let $kludge := deltaxml:warn(concat('No label in @deltaxml:original-position for ', $original-positions-string, ' at input document node ', path($item))) return if($kludge) then xs:double('INF') else xs:double('INF')
          else
            xs:integer(number($pos))"/>
    </xsl:copy>
  </xsl:template>


  

</xsl:stylesheet>