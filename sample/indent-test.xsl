<abc name="foo
           bar"/>

<variableparm name="var1" 
              select="
                if ($a) then
                $b
                else
                $c"/>

<xsl:variable name="var1" select="
                            if ($a) then
                                if ($b) then
                                    new
                                else
                                oldF
                            else
                            $c"/>

<xsl:variable name="var1" 
              select="
                [abc
                    [ght
                        [ppp                                        
                        ]
                    ]
                ]
                "/>

<xsl:variable name="var1" 
              select="
                for $a in
                    1 to 25
                    return
                        $abc,
                $def
                "/>

<xsl:variable name="var1" 
              select="
                every $a in $coll,
                    $b in $a * 5
                        satisfies $a lt 200
                            and $a gt 20
                "/>