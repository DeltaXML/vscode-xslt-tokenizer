<xsl:variable name="morerows-new-values" 
              select="
              for $version in $morerows-versions return
              if(tokenize(deltaxml:nearest-delta($row-or-element), '!=|=') = $version)
              then
              html:nextMoreRowsValue($morerows[index-of($morerows-versions,$version)], $morerows-values-updated[index-of($morerows-versions,$version)])
              else
              $morerows[index-of($morerows-versions,$version)]
              "/>