<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                version="3.0">
  
  <xsl:variable name="dfx:columnsOccurInOrderForVersions" as="xs:boolean">
    <xsl:variable name="colDataWithOriginalPositions" as="map(~dfx:version, xs:integer)*"/>
    <xsl:variable name="rowVersions" as="xs:string*"/>
    <xsl:sequence select="fold-left(
        $colDataWithOriginalPositions, 
        map{'ordered': true(), 'versions': map{}},
        function($accumulator, $col) 
        {
          if(not($accumulator?ordered)) then $accumulator
          else 
            let $ordered := every $version in $rowVersions satisfies 
                if(exists($accumulator?versions($version)) and exists($col($version))) 
                  then $col($version) gt $accumulator?versions($version) 
                else true(),
                $merged := map:merge($col, $accumulator?versions) (: use-first... last entry in colDataWithOriginalPositions will override previous :)
            return map { 'ordered' : $ordered, 'versions': $merged}
        })?ordered"/>
  </xsl:variable>
  
  <xsl:variable name="test" 
    select="                                
      let $spanFromAbove := 1,
        $spanAboveActive := if(true()) then 2 else 3
      return ($spanAboveActive, $spanFromAbove)
    "/>
  
  <xsl:variable name="test2"
    select="let $a := 2, $b := $a return ($a, $b)
    "/>
  <xsl:variable name="test3"
    select="let $a :=2, $b := if ($a) then 2 else $a return if ($a) then $a else $b
    "/>
  
  <xsl:template name="new" as="item()">
    
  </xsl:template>
  
  
</xsl:stylesheet>