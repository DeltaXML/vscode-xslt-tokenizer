<!--
    abc
    $def
-->

<xsl:variable name="var1" 
    select="
        22,
        (
            for $table in 1 to 10,
                $row in 5 to 8,
                $cell in 20 to 30
            return
                $table + $row + $cell
            ),
            86
    "/>

<xsl:variable name="var1" 
    select="
        (
            for $table in 1 to 10
            return
                for $row in 5 to 8
                return
                    for $cell in 20 to 30
                    return
                        for $cell-part in 8 to 12
                        return
                            $table + $row + $cell
                        )
                        258
    "/>

<xsl:variable name="var1" 
    select="
        [abc
            [ght
                [ppp                                        
                ]
            ]
        ]
    "/>

<abc name="foo
           bar"/>

<variableparm name="var1" 
              select="if ($a) then
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

<xsl:variable name="var1" select="
    if ($a) then
        a 
    else if ($b) then $b 
    else
        $c"/>

<xsl:variable name="var1" select="
    if ($a) then
        a 
    else 
        if ($b) then
            $b 
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
        (
            if ($abc) then
                if ($def) then
                    if ($jkl) then
                        1
                    else
                        2
                else
                    3
            else
                4,
                5
            )
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