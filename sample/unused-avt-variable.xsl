<xsl:sequence select="let $b := 2, let $q := function($a) {$a, $b, $q} return $q"/>



