<xsl:variable name="var1" select="
                                if ($a) then
                                $b
                                else
                                $c"/>

<xsl:variable name="var1" 
              select="
                    for $a in 1 to 25
                    return
                    $abc
                    "/>

<xsl:variable name="var1" 
              select="
                    every $a in $coll
                    satisfies $a lt 200
                    and $a gt 20
                    "/>