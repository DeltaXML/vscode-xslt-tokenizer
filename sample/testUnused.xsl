<xsl:sequence select="let $init1 := 5, $a := function($p1, $in) {$p1, $a} return $aq, $init1"/>

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