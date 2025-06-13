<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:fn="http://www.w3.org/2005/xpath-functions"
                version="3.0">

  <?test-attribute select?>
  <xsl:variable name="expression1" select="1 + 1"/>
  <xsl:variable name="expression2" select="5 div 20"/> 
  <xsl:variable name="expression3" select="10 mod xs:integer('1')"/> 
  <xsl:variable name="expression4" select="3 * 7"/>
  <xsl:variable name="expression5" select="20 idiv 3"/>
  <xsl:variable name="expression6" select="2 - 5"/>
  <xsl:variable name="expression7" select="(1, 2, 3) = 2"/>
  <xsl:variable name="expression8" select="(1, 2, 3) != 4"/>
  <xsl:variable name="expression9" select="5 > 2"/>
  <xsl:variable name="expression10" select="5 >= 5"/>
  <xsl:variable name="expression11" select="2 < 3"/>
  <xsl:variable name="expression12" select="2 <= 2"/>
  <xsl:variable name="expression13" select="true() and false()"/>
  <xsl:variable name="expression14" select="true() or false()"/>
  <xsl:variable name="expression15" select="(1, 2) union (2, 3)"/>
  <xsl:variable name="expression16" select="(1, 2, 3) intersect (2, 3, 4)"/>
  <xsl:variable name="expression17" select="(1, 2, 3) except (2)"/>
  <xsl:variable name="expression18" select="'foo' || 'bar'"/>
  <xsl:variable name="expression19" select="(1 to 5)"/>
  <xsl:variable name="expression20" select="map { 'a': 1, 'b': 2 }!string(.)"/>
  <xsl:variable name="expression21" select="(1, 2, 3)!upper-case(string(.))"/>
  <xsl:variable name="expression22" select="(1, 2, 3) => count()"/>
  <xsl:variable name="expression23" select="some $x in (1,2,3) satisfies $x > 1"/>
  <xsl:variable name="expression24" select="every $x in (1,2,3) satisfies $x > 0"/>
  <xsl:variable name="expression25" select="5 instance of xs:integer"/>
  <xsl:variable name="expression26" select="5 cast as xs:string"/>
  <xsl:variable name="expression27" select="5 castable as xs:string"/>
  <xsl:variable name="expression28" select="5 treat as xs:integer"/>
  <xsl:variable name="expression29" select="/root/child"/>
  <xsl:variable name="expression30" select="//item"/>

  <!-- Axis examples -->
  <xsl:variable name="expression31" select="child::book"/>
  <xsl:variable name="expression32" select="descendant::chapter"/>
  <xsl:variable name="expression33" select="ancestor::section"/>
  <xsl:variable name="expression34" select="following-sibling::para"/>
  <xsl:variable name="expression35" select="preceding::note"/>
  <xsl:variable name="expression36" select="self::node()"/>
  <xsl:variable name="expression37" select="attribute::lang"/>
  <xsl:variable name="expression38" select="namespace::*"/>

  <!-- Predicates -->
  <xsl:variable name="expression39" select="book[author='John']"/>
  <xsl:variable name="expression40" select="item[position() = 1]"/>
  <xsl:variable name="expression41" select="chapter[title and page > 10]"/>
  <xsl:variable name="expression42" select="(1 to 10)[. mod 2 = 0]"/>

  <!-- Array constructors and access -->
  <xsl:variable name="expression43" select="[]"/>
  <xsl:variable name="expression44" select="[1, 2, 3]"/>
  <xsl:variable name="expression45" select="['a', 'b', 'c']"/>
  <xsl:variable name="expression46" select="([10, 20, 30])[2]"/>
  <xsl:variable name="expression47" select="(([1, 2, 3],[4, 5]) => array:join())"/>

  <!-- Map constructors and access -->
  <xsl:variable name="expression48" select="map{}"/>
  <xsl:variable name="expression49" select="map{ 'x': 1, 'y': 2 }"/>
  <xsl:variable name="expression50" select="map{ 'foo': [1,2,3] }('foo')"/>
  <xsl:variable name="expression51" select="map{ 'a': 1, 'b': 2 }?a"/>
  <xsl:variable name="expression52" select="map{ 'nested': map{ 'inner': 42 } }?nested?inner"/>

  <!-- Array and map with functions -->
  <xsl:variable name="expression53" select="[1, 2, 3] => array:filter(function($i) { $i mod 2 = 1 })"/>
  <xsl:variable name="expression54" select="map{ 'nums': [1,2,3] }?nums[. > 1]"/>

  <!-- Let and For expressions -->
  <xsl:variable name="let1" select="let $x := 5 return $x * 2"/>
  <xsl:variable name="let2" select="let $a := 1, $b := 2 return $a + $b"/>
  <xsl:variable name="for1" select="for $i in 1 to 3 return $i * $i"/>
  <xsl:variable name="for2" select="for $x in (10, 20), $y in (1, 2) return $x + $y"/>
  <xsl:variable name="nestedLetFor1" select="for $i in 1 to 3 return let $j := $i * 2 return $j + 1"/>
  <xsl:variable name="nestedLetFor2" select="let $seq := (1,2,3) return for $n in $seq return $n * 10"/>
  <xsl:variable name="nestedForLet" select="for $x in (1,2) return for $y in (3,4) return let $z := $x + $y return $z * 2"/>
  <xsl:variable name="letInPredicate" select="(1 to 10)[let $v := . * 2 return $v > 10]"/>

  <!-- If/Else expressions -->
  <xsl:variable name="if1" select="if (2 > 1) then 'yes' else 'no'"/>
  <xsl:variable name="if2" select="if (false()) then 0 else 1"/>
  <xsl:variable name="if3" select="if (3 = 3) then (10, 20) else (30, 40)"/>
  <xsl:variable name="if4" select="if (1 = 2) then (1, 2, 3) else 99"/>
  <xsl:variable name="if5" select="if (true()) then (('a', 'b')) else (('c', 'd'))"/>
  <xsl:variable name="if6" select="if (5 > 10) then (1, if (2 = 2) then 2 else 3) else (4, 5)"/>
  <xsl:variable name="if7" select="if (false()) then (if (true()) then 'x' else 'y', 'z') else ('a', 'b')"/>
  <xsl:variable name="if8" select="for $i in 1 to 2 return if ($i = 1) then ('first', $i) else ('second', $i)"/>

  <!-- Function literals and inline function expressions -->
  <xsl:variable name="fnLiteral1" select="function($x) { $x * 2 }"/>
  <xsl:variable name="fnLiteral2" select="(1 to 3) => for-each(function($n) { $n + 10 })"/>

  <!-- Dynamic function calls and partial application -->
  <xsl:variable name="dynFnCall1-PENDING" select="upper-case?('abc')"/>
  <xsl:variable name="partialFn1-PENDING" select="substring-before?('foobar', 'bar')"/>
  <xsl:variable name="partialFn2-PENDING" select="concat?('a', ?)('b')"/>

  <!-- Type expressions with sequence types -->
  <xsl:variable name="typeExpr1-PENDING" select="(1, 2, 3) treat as xs:integer*"/>
  <xsl:variable name="typeExpr2-PENDING" select="'abc' cast as xs:string?"/>
  <xsl:variable name="typeExpr3-PENDING" select="5 instance of xs:integer+"/>

  <!-- Path expressions with parenthesis grouping -->
  <xsl:variable name="pathGroup1" select="(/root/child)[1]"/>
  <xsl:variable name="pathGroup2" select="(//item)[position() lt 3]"/>

  <!-- Context item expressions -->
  <xsl:variable name="contextItem1" select="."/>
  <xsl:variable name="contextItem2" select=".//node()"/>

  <!-- Map and array lookup with computed keys/indices -->
  <xsl:variable name="mapLookup1" select="map{ 'a': 1, 'b': 2 }?concat('a', '')"/>
  <xsl:variable name="arrayLookup1" select="[10, 20, 30][1 + 1]"/>

  <!-- fn:apply, fn:filter, fn:fold-left/right -->
  <xsl:variable name="fnApply1" select="fn:apply(function($a, $b) { $a + $b }, [1, 2])"/>
  <xsl:variable name="fnFilter1" select="fn:filter(function($n) { $n mod 2 = 0 }, (1,2,3,4))"/>
  <xsl:variable name="fnFoldLeft1" select="fn:fold-left((1,2,3), 0, function($a, $b) { $a + $b })"/>

  <!-- Higher-order functions with closures -->
  <xsl:variable name="closure1" select="let $f := function($x) { $x + 1 } return $f(10)"/>

  <!-- Positional variables in predicates -->
  <xsl:variable name="posPred1" select="(10, 20, 30)[position() mod 2 = 1]"/>

  <!-- document(), collection(), doc-available() -->
  <xsl:variable name="doc1" select="document('somefile.xml')/root"/>
  <xsl:variable name="coll1" select="collection()[1]"/>
  <xsl:variable name="docAvail1" select="doc-available('somefile.xml')"/>

  <!-- let/for/if inside map/array constructors -->
  <xsl:variable name="mapWithLet" select="map{ 'x': let $a := 2 return $a * 10 }"/>
  <xsl:variable name="arrayWithFor" select="[for $i in 1 to 3 return $i * 2]"/>
  <xsl:variable name="arrayWithIf" select="[if (2 > 1) then 'ok' else 'fail']"/>

  <!-- if/else if/else as switch substitute -->
  <xsl:variable name="switchSub1" select="let $x := 1 return if ($x = 1) then 'one' else if ($x = 2) then 'two' else 'other'"/>

  <!-- Attribute name tests -->
  <xsl:variable name="attrTest1" select="@class"/>
  <xsl:variable name="attrTest2" select="//div/@id"/>
  <xsl:variable name="attrTest3" select="book/@*"/>

  <!-- Node tests -->
  <xsl:variable name="nodeTest1" select="text()"/>
  <xsl:variable name="nodeTest2" select="//para/text()"/>
  <xsl:variable name="nodeTest3" select="processing-instruction()"/>
  <xsl:variable name="nodeTest4" select="processing-instruction('xml-stylesheet')"/>

  <!-- Nested map and array constructor examples -->
  <xsl:variable name="nestedMap1" select="map{ 'outer': map{ 'inner': 123 } }"/>
  <xsl:variable name="nestedMap2" select="map{ 'a': map{ 'b': map{} } }"/>
  <xsl:variable name="arrayCurly1" select="array{ (1, 2, 3) }"/>
  <xsl:variable name="arrayCurly2" select="array{ [10, 20], array{()} }"/>
  <xsl:variable name="arraySquare1" select="[[1, 2], [3, 4]]"/>
  <xsl:variable name="arraySquare2" select="[array{(5, 6)}, []]"/>

  <!-- Anonymous function assigned and invoked via let -->
  <xsl:variable name="letAnonFnInvoke" select="let $f := function($x) { $x * 10 } return $f(7)"/>

  <!-- Assigning named built-in functions to variables and invoking them -->
  <xsl:variable name="fnVar1" select="upper-case#1"/>
  <xsl:variable name="fnVar2" select="string-length#1"/>
</xsl:stylesheet>