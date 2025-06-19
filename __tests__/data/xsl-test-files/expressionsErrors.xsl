<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:array="http://www.w3.org/2005/xpath-functions/array"
                xmlns:fn="http://www.w3.org/2005/xpath-functions"
                version="3.0">

  <?test-attribute select?>
  <xsl:variable name="expressionNoErr1" select="1 ++ 1"/>
  <xsl:variable name="expressionErr2" select="5 div 2E"/> 
  <xsl:variable name="expressionErr3" select="10 mode xs:integer('1')"/> 
  <xsl:variable name="expressionErr4" select="3 ** 7"/>
  <xsl:variable name="expressionErr5" select="20 idiv 3e"/>
  <xsl:variable name="expressionNoErr6" select="2 -- 5"/>
  <xsl:variable name="expressionErr7" select="(1, 2, 3) !!= 2"/>
  <xsl:variable name="expressionErr8" select="(1, 2, 3 != 4"/>
  <xsl:variable name="expressionErr9-PENDING" select="5 >> 2"/>
  <xsl:variable name="expressionErr10" select="5 >= 5"/>
  <xsl:variable name="expressionErr11" select="2 < 3"/>
  <xsl:variable name="expressionErr12" select="2 <= 2"/>
  <xsl:variable name="expressionErr13" select="true(j) and false()"/>
  <xsl:variable name="expressionErr14" select="true() or fals()"/>
  <xsl:variable name="expressionErr15" select="(1, 2) unon (2, 3)"/>
  <xsl:variable name="expressionErr16" select="(1, 2, 3) intersect 2, 3, 4)"/>
  <xsl:variable name="expressionErr17" select="(1, 2, 3) exept (2)"/>
  <xsl:variable name="expressionErr18" select="'foo' | 'bar'"/>
  <xsl:variable name="expressionErr19" select="(1 tox 5)"/>
  <xsl:variable name="expressionErr20-PENDING" select="map { 'a': 1, 'b': 2 }string(.)"/>
  <xsl:variable name="expressionErr21" select="(1, 2, 3)!upper-case(string(.))"/>
  <xsl:variable name="expressionErr22" select="(1, 2, 3) => count(2)"/>
  <xsl:variable name="expressionErr23-PENDING" select="some $x in (1,2,3),4 satisfies $x > 1"/>
  <xsl:variable name="expressionErr24" select="every $x in (1,2,3),a satisfies $x > 0"/>
  <xsl:variable name="expressionErr25" select="5 instance of node()"/>
  <xsl:variable name="expressionErr26-PENDING" select="5 cast as node()"/>
  <xsl:variable name="expressionErr27" select="5 castable as xs:string"/>
  <xsl:variable name="expressionErr28" select="5 treat as xs:integer"/>
  <xsl:variable name="expressionErr28b-PENDING" select="5 treat as 5"/>
  <xsl:variable name="expressionErr28c" select="5 treat as node()"/>

  <!-- Axis examples -->
  <xsl:variable name="noContextaxisErr29" select="/root/child"/>
  <xsl:variable name="noContextaxisErr30" select="//item"/>
  <xsl:variable name="noContextaxisErr30b" select="item"/>
  <xsl:variable name="axisErr31" select="childa::book"/>
  <xsl:variable name="axisErr32" select="descendant::descendant::chapter"/>
  <xsl:variable name="axisErr33" select="ancestor::55"/>
  <xsl:variable name="axisErr34-PENDING" select="following-sibling[1]::para"/>
  <xsl:variable name="axisErr35-PENDING" select="(preceding)::note"/>
  <xsl:variable name="axisErr36" select="self::@class"/>
  <xsl:variable name="axisErr37" select="attributes::lang"/>
  <xsl:variable name="axisErr38" select="namespace::**"/>

  <!-- Predicates -->
  <xsl:variable name="qnameErr39" select=":book[author='John']"/>
  <xsl:variable name="qnameErr40" select="q:item[position() = 1]"/>
  <xsl:variable name="qnameErr41" select="cha pter[title and page > 10]"/>
  <xsl:variable name="qnameNoErr41a" select="cha to abc"/>
  <xsl:variable name="expressionErr42" select="(1 to 10 . mod 2 = 0]"/>

  <!-- Array constructors and access -->
  <xsl:variable name="expressionErr43" select="["/>
  <xsl:variable name="expressionErr44" select="[1, 2, 3"/>
  <xsl:variable name="expressionErr45" select="['a', 'b' 'c']"/>
  <xsl:variable name="expressionErr46" select="([10, 20, 30])[2a]"/>
  <xsl:variable name="expressionErr47" select="(([1, 2, 3],[4, 5]) => array:join())"/>

  <!-- Map constructors and access -->
  <xsl:variable name="expressionErr48" select="map{{}}"/>
  <xsl:variable name="expressionErr49" select="map{ 'x': 1 'y': 2 }"/>
  <xsl:variable name="expressionErr50" select="map{ 'foo', [1,2,3] }('foo')"/>

  <!-- Array and map with functions -->
  <xsl:variable name="expressionErr53" select="[1, 2, 3] => array:filter(function($i as) { $i mod 2 = 1 })"/>
  <xsl:variable name="expressionErr53b-PENDING" select="[1, 2, 3] => array:filter(function($i as xs:integer) as { $i mod 2 = 1 })"/>
  <xsl:variable name="expressionErr53c" select="[1, 2, 3] => array:filter(function($i as xs:intege) { $i mod 2 = 1 })"/>

  <!-- Let and For expressions -->
  <xsl:variable name="letErr1" select="let $x := 5 return $xyy * 2"/>
  <xsl:variable name="letNoErr2" select="let $a := 1, $a := 2 return $a"/>
  <xsl:variable name="forErr1" select="for $i in 1 to 3 retur $i * $i"/>
  <xsl:variable name="forErr2" select="for $x in (10, 20), $y in 1, 2 return $x + $y"/>
  <xsl:variable name="nestedLetForErr1" select="for $i in 1 to 3 let $j := $i * 2 return $j + 1"/>
  <xsl:variable name="nestedLetForErr2" select="$seq := (1,2,3) return for $n in $seq return $n * 1"/>
  <xsl:variable name="nestedForLet" select="for $x in (1,2) return for $y in (3,4) return let $z $x + $y return $z * 2"/>
  <xsl:variable name="letInPredicate" select="(1 to 10)[let $v := . * 2 return $v > 10]"/>

  <!-- If/Else expressions -->
  <xsl:variable name="ifErr1" select="if (2 > 1) then 'yes'"/>
  <xsl:variable name="ifErr2" select="(false()) then 0 else 1"/>
  <xsl:variable name="ifErr3" select="if (3 = 3) then (10, 20) else (30, 40) else 2"/>
  <xsl:variable name="ifErr4" select="if (1 = 2) then (1, 2, 3) else "/>
  <xsl:variable name="ifErr5" select="if (true()) then (('a', 'b')) else else (('c', 'd'))"/>
  <xsl:variable name="ifErr6-PENDING" select="22 if (2 = 2) then 2 else 3"/>
  <xsl:variable name="ifErr6b-PENDING" select="(count(2)) if (2 = 2) then 2 else 3"/>
  <xsl:variable name="ifErr7" select="if (false() then (if (true())) then 'x' else 'y', 'z') else ('a', 'b')"/>
  <xsl:variable name="ifErr8" select="for $i in 1 to 2 return ($i = 1) then ('first', $i) else ('second', $i)"/>
  <xsl:variable name="ifErr" select="'book' if (1) then 1 else 2"/>


  <!-- Function literals and inline function expressions -->
  <xsl:variable name="fnLiteralErr1-PENDING" select="function($x, 5) { $x * 2 }"/>
  <xsl:variable name="fnLiteralErr1a-PENDING" select="function($x, ()) { $x * 2 }"/>
  <xsl:variable name="fnLiteralErr1b" select="function($x, ) { $x * 2 }"/>
  <xsl:variable name="fnLiteralErr1c" select="function($x as xs:strin ) { $x * 2 }"/>
  <xsl:variable name="fnLiteralErr2" select="(1 to 3) => for-each(function($n) { $nz + 10 })"/>

  <!-- Dynamic function calls and partial application -->
  <xsl:variable name="dynFnCallErr1" select="upper-case#('abc')"/>
  <xsl:variable name="partialFnErr1" select="substring-before#4('foobar', 'bar')"/>
  <xsl:variable name="partialFnErr2" select="concat('a', ??)('b')"/>

  <!-- Path expressions with parenthesis grouping -->
  <xsl:variable name="pathGroupErr1" select="(/root/child/)[1]"/>
  <xsl:variable name="pathGroupErr2" select="(///item)[position() lt 3]"/>

  <!-- Context item expressions -->
  <xsl:variable name="contextItemErr1" select="./"/>
  <xsl:variable name="contextItemErr2-PENDING" select="...//node()"/>

  <!-- Map and array lookup with computed keys/indices -->
  <xsl:variable name="arrayLookupErr1" select="[10, 20, 30][1 + ]"/>

  <!-- fn:apply, fn:filter, fn:fold-left/right -->
  <xsl:variable name="fnApplyErr1" select="fn:apply(function($a as node(), $b as xs:anyAtomicType, $c) { $a + $b }, [1, 2])"/>
  <xsl:variable name="fnFilterErr1" select="fn:filter(function($n) { mod 2 = 0 }, (1,2,3,4))"/>
  <xsl:variable name="fnFoldLeftErr1" select="fn:fold-left((1,2,3), 0, function($a, $b) { $a + $b }, 22)"/>

  <!-- Higher-order functions with closures -->
  <xsl:variable name="closureErr1-PENDING" select="let $f := function($x) { $x + 1 } as xs:integer return $f(10)"/>
  <xsl:variable name="closureErr1" select="let $f := function($x) as xs:intege { $x + 1 } return $f(10)"/>

  <!-- Positional variables in predicates -->
  <xsl:variable name="posPredErr1-PENDING" select="(10, 20, 30)[]"/>

  <!-- document(), collection(), doc-available() -->
  <xsl:variable name="docErr1" select="document('somefile.xml')/qq:root"/>
  <xsl:variable name="docAvailErr1" select="doc-available('somefile.xml)"/>

  <!-- let/for/if inside map/array constructors -->
  <xsl:variable name="mapWithLet" select="map{ 'x': let $a := 2 return $a * 10 "/>
  <xsl:variable name="arrayWithFor" select="[[for $i in 1 to 3 return $i * 2]"/>
  <xsl:variable name="arrayWithIf" select="[if (2 > 1 then 'ok') else 'fail']"/>

  <!-- if/else if/else as switch substitute -->
  <xsl:variable name="switchSubErr1" select="let $x := 1 return if ($x = 1) then 'one' if ($x = 2) then 'two' else 'other'"/>

  <!-- Attribute name tests -->
  <xsl:variable name="attrTestErr1" select="@qq:class"/>
  <xsl:variable name="attrTestErr2" select="//div/@"/>
  <xsl:variable name="attrTestErr3-PENDING" select="book/@**"/>

  <!-- Node tests -->
  <xsl:variable name="nodeTestErr1-PENDING" select="text(ANY)"/>
  <xsl:variable name="nodeTestErr4-PENDING" select="processing-instruction('xml-stylesheet', 'a')"/>
  <xsl:variable name="nodeTestErr2" select="//para/texts()"/>
  <xsl:variable name="nodeTestNoErr3" select="processing-instruction(any)"/>

  <!-- Nested map and array constructor examples -->
  <xsl:variable name="nestedMapErr1" select="map{ 'outer': array{ 'inner': 123 } }"/>
  <xsl:variable name="nestedMapErr2" select="map{ 'a': map{ 'b', map{} } }"/>
  <xsl:variable name="nestedMapNoErr2" select="[1,2,3]?2"/>
  <xsl:variable name="arrayCurlyErr1-PENDING" select="array{ 1, 2, 3 }a"/>

  <!-- VERIFY VARIABLE $X$X -->
  <xsl:variable name="letAnonFnInvoke-PENDING" select="let $f := function($x$x) { $x$x * 10 } return $f(7)"/>

  <!-- Assigning named built-in functions to variables and invoking them -->
  <xsl:variable name="fnVarErr1" select="upper-case1#"/>
  <xsl:variable name="fnVarErr2" select="string-length##1"/>
  
  <!-- String literals in expressions -->
  <xsl:variable name="stringErr42" select="if (1) then 1 else 2 'book'"/>
  <xsl:variable name="stringErr34" select="22 * 'book'"/>
  <xsl:variable name="stringErr35" select="22 + 'book'"/>
  <xsl:variable name="stringErr36" select="'book' let $a := 2 return $a"/>
  <xsl:variable name="stringErr37" select="'book' every $a in (1,2) satisfies $a"/>
  <xsl:variable name="stringErr31" select="'book' 1"/>
  <xsl:variable name="stringErr32" select="22 'book'"/>
  <xsl:variable name="stringErr33" select="'book'*"/>
  <xsl:variable name="stringErr40" select="*'book'"/>
  <xsl:variable name="nodeStringErr37" select="Q{'test'}name 'book'"/>
  <xsl:variable name="stringErr38" select="let $a := '1' return 'book' $a"/>
  <xsl:variable name="stringErr39" select="let $a := '1' return $a 'book'"/>
  <xsl:variable name="stringErr43" select="22 div 'book'"/>

  <xsl:variable name="bangStart23" select="!'book'"/>
  <xsl:variable name="stringNoErr2" select="'book'!'title'"/>
  <xsl:variable name="stringErr3" select="'book'+'title'"/>
  <xsl:variable name="stringNoErr4" select="'book','title'"/>
  <xsl:variable name="stringNoErr8" select="['book']"/>
  <xsl:variable name="stringNoErr9" select="('book')"/>
  <xsl:variable name="stringErr10" select="'book' 'title'"/>
  <xsl:variable name="nodeStringErr10" select="'book' any"/>
  <xsl:variable name="nodeStringErr11" select="any 'book'"/>
  <xsl:variable name="nodeStringErr13" select="'book'count(1)"/>
  <xsl:variable name="nodeStringErr15" select="[]'book'"/>
  <xsl:variable name="nodeStringErr16" select="()'book'"/>
  <xsl:variable name="nodeStringErr17" select="(1)'book'"/>

  <xsl:variable name="nodeStringNoErr18a" select="'book' instance of xs:string"/>
  <xsl:variable name="nodeStringNoErr18b" select="'book' castable as xs:string"/>
  
  <xsl:variable name="nodeStringNoErr22" select="'book' => count()"/>
  <xsl:variable name="nodeStringNoErr23" select="'book'!count(.)"/>
  <xsl:variable name="stringErr24" select="'book'/'book'"/>
  <xsl:variable name="nodeStringNoErr25" select="any/'book'"/>
  <xsl:variable name="nodeStringErr26" select="'book'/any"/>
  <xsl:variable name="nodeStringErr27" select="'book'any"/>
  <xsl:variable name="nodeStringErr28" select="any'book'"/>
  <xsl:variable name="stringNoErr29" select="map{}?'book'"/>
  <xsl:variable name="stringNoErr30" select="?'book'"/>
  <xsl:variable name="stringErr1" select="'book'as'title'"/>
  <xsl:variable name="stringErr5" select="'book'map{}"/>
  <xsl:variable name="stringErr6" select="'book'array{}"/>
  <xsl:variable name="stringErr7" select="'book'{}"/>
  <xsl:variable name="stringErr33b" select="'book' * 22"/>
  <xsl:variable name="stringErr34b" select="'book' div 298"/>
  
  <xsl:variable name="stringErr8" select="{'book'}"/>
  <xsl:variable name="nodeStringErr12" select="'book'()"/>
  <xsl:variable name="nodeStringErr14" select="'book'(1)"/>
  <xsl:variable name="nodeStringErr15b" select="'book'[]"/>
  <xsl:variable name="stringErrMessage39" select="'book' count(1)"/>
  <xsl:variable name="stringNoErr1" select="'&#160;'"/>
  
</xsl:stylesheet>