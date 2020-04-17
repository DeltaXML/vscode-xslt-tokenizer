<xsl:sequence select="
    let $a := 1,
        $b := 3 + $b return $bx"/>

<xsl:sequence select="
    let $a := 1,
        $b := 3 + $b 
    return $a"/>

<xsl:sequence select="
    let $a := 1,
        $b := 3 + $a 
    return $b"/>

<xsl:sequence select="
    let $a := 1,
        $b := 2,
        $b := 3
    return $b"/>

<xsl:sequence select="
    let $a := 1,
        $b := 2,
        $c := 3
    return $a,$bx,$c"/>