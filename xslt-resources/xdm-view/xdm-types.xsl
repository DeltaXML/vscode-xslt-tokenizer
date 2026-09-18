<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:xdm="http://deltaxignia.com/ns/xdm-persistence"
                xmlns:zxd="http://deltaxignia.com/ns/xdm-persistence/internal"
                exclude-result-prefixes="#all"
                version="3.0">

  <!--
       (c) DeltaXignia ltd. 2026
       Shared vocabulary for XDM persistence: the interchange namespace,
       plus atomic-type name detection and lexical cast-back, used by
       both xdm-serializer.xsl and xdm-parser.xsl.
  -->

  <xsl:variable name="xdm:ns" as="xs:string" select="'http://deltaxignia.com/ns/xdm-persistence'"/>
  <xsl:variable name="xdm:xsd-ns" as="xs:string" select="'http://www.w3.org/2001/XMLSchema'"/>

  <!-- Resolves a type/key-type attribute (e.g. type="xs:integer") to its
       canonical 'xs:localName' form, using genuine namespace resolution
       rather than a literal string match on the 'xs' prefix - so a document
       that binds the XML Schema namespace to a different prefix still
       parses correctly. Terminates with a clear error if the attribute
       resolves to some other namespace, rather than silently degrading the
       value (e.g. to xs:untypedAtomic). -->
  <xsl:function name="zxd:resolve-type-name" as="xs:string">
    <xsl:param name="typeAttr" as="attribute()"/>
    <xsl:variable name="qname" as="xs:QName" select="resolve-QName($typeAttr, $typeAttr/..)"/>
    <xsl:if test="namespace-uri-from-QName($qname) ne $xdm:xsd-ns">
      <xsl:message terminate="yes" select="
        'xdm-persistence: ' || name($typeAttr) || '=&quot;' || string($typeAttr) ||
        '&quot; resolves to namespace ''' || namespace-uri-from-QName($qname) ||
        ''' - expected the XML Schema namespace (' || $xdm:xsd-ns || ')'"/>
    </xsl:if>
    <xsl:sequence select="'xs:' || local-name-from-QName($qname)"/>
  </xsl:function>

  <!-- Most-specific built-in XSD atomic type name for a value (e.g. 'xs:integer').
       Branches are ordered most-derived-first so a subtype is never misreported
       as one of its base types. xs:NOTATION cannot be constructed from a cast in
       plain XPath, so zxd:cast-atomic degrades it to xs:untypedAtomic on parse. -->
  <xsl:function name="zxd:type-name" as="xs:string">
    <xsl:param name="value" as="xs:anyAtomicType"/>
    <xsl:choose>
      <xsl:when test="$value instance of xs:unsignedByte">xs:unsignedByte</xsl:when>
      <xsl:when test="$value instance of xs:unsignedShort">xs:unsignedShort</xsl:when>
      <xsl:when test="$value instance of xs:unsignedInt">xs:unsignedInt</xsl:when>
      <xsl:when test="$value instance of xs:unsignedLong">xs:unsignedLong</xsl:when>
      <xsl:when test="$value instance of xs:positiveInteger">xs:positiveInteger</xsl:when>
      <xsl:when test="$value instance of xs:negativeInteger">xs:negativeInteger</xsl:when>
      <xsl:when test="$value instance of xs:byte">xs:byte</xsl:when>
      <xsl:when test="$value instance of xs:short">xs:short</xsl:when>
      <xsl:when test="$value instance of xs:int">xs:int</xsl:when>
      <xsl:when test="$value instance of xs:long">xs:long</xsl:when>
      <xsl:when test="$value instance of xs:nonNegativeInteger">xs:nonNegativeInteger</xsl:when>
      <xsl:when test="$value instance of xs:nonPositiveInteger">xs:nonPositiveInteger</xsl:when>
      <xsl:when test="$value instance of xs:integer">xs:integer</xsl:when>
      <xsl:when test="$value instance of xs:decimal">xs:decimal</xsl:when>
      <xsl:when test="$value instance of xs:float">xs:float</xsl:when>
      <xsl:when test="$value instance of xs:double">xs:double</xsl:when>
      <xsl:when test="$value instance of xs:dayTimeDuration">xs:dayTimeDuration</xsl:when>
      <xsl:when test="$value instance of xs:yearMonthDuration">xs:yearMonthDuration</xsl:when>
      <xsl:when test="$value instance of xs:duration">xs:duration</xsl:when>
      <xsl:when test="$value instance of xs:dateTime">xs:dateTime</xsl:when>
      <xsl:when test="$value instance of xs:date">xs:date</xsl:when>
      <xsl:when test="$value instance of xs:time">xs:time</xsl:when>
      <xsl:when test="$value instance of xs:gYearMonth">xs:gYearMonth</xsl:when>
      <xsl:when test="$value instance of xs:gYear">xs:gYear</xsl:when>
      <xsl:when test="$value instance of xs:gMonthDay">xs:gMonthDay</xsl:when>
      <xsl:when test="$value instance of xs:gMonth">xs:gMonth</xsl:when>
      <xsl:when test="$value instance of xs:gDay">xs:gDay</xsl:when>
      <xsl:when test="$value instance of xs:boolean">xs:boolean</xsl:when>
      <xsl:when test="$value instance of xs:base64Binary">xs:base64Binary</xsl:when>
      <xsl:when test="$value instance of xs:hexBinary">xs:hexBinary</xsl:when>
      <xsl:when test="$value instance of xs:anyURI">xs:anyURI</xsl:when>
      <xsl:when test="$value instance of xs:QName">xs:QName</xsl:when>
      <xsl:when test="$value instance of xs:NOTATION">xs:NOTATION</xsl:when>
      <xsl:when test="$value instance of xs:string">xs:string</xsl:when>
      <xsl:otherwise>xs:untypedAtomic</xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <!-- Reconstructs an atomic value of the given type name from its canonical
       lexical string (as produced by serialize(., map{'method':'text'})).
       xs:QName is handled separately by zxd:cast-qname since it needs a
       namespace URI, not just a lexical string. -->
  <xsl:function name="zxd:cast-atomic" as="xs:anyAtomicType">
    <xsl:param name="typeName" as="xs:string"/>
    <xsl:param name="lexical" as="xs:string"/>
    <xsl:choose>
      <xsl:when test="$typeName eq 'xs:unsignedByte'"><xsl:sequence select="xs:unsignedByte($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:unsignedShort'"><xsl:sequence select="xs:unsignedShort($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:unsignedInt'"><xsl:sequence select="xs:unsignedInt($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:unsignedLong'"><xsl:sequence select="xs:unsignedLong($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:positiveInteger'"><xsl:sequence select="xs:positiveInteger($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:negativeInteger'"><xsl:sequence select="xs:negativeInteger($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:byte'"><xsl:sequence select="xs:byte($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:short'"><xsl:sequence select="xs:short($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:int'"><xsl:sequence select="xs:int($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:long'"><xsl:sequence select="xs:long($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:nonNegativeInteger'"><xsl:sequence select="xs:nonNegativeInteger($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:nonPositiveInteger'"><xsl:sequence select="xs:nonPositiveInteger($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:integer'"><xsl:sequence select="xs:integer($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:decimal'"><xsl:sequence select="xs:decimal($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:float'"><xsl:sequence select="xs:float($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:double'"><xsl:sequence select="xs:double($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:dayTimeDuration'"><xsl:sequence select="xs:dayTimeDuration($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:yearMonthDuration'"><xsl:sequence select="xs:yearMonthDuration($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:duration'"><xsl:sequence select="xs:duration($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:dateTime'"><xsl:sequence select="xs:dateTime($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:date'"><xsl:sequence select="xs:date($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:time'"><xsl:sequence select="xs:time($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:gYearMonth'"><xsl:sequence select="xs:gYearMonth($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:gYear'"><xsl:sequence select="xs:gYear($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:gMonthDay'"><xsl:sequence select="xs:gMonthDay($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:gMonth'"><xsl:sequence select="xs:gMonth($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:gDay'"><xsl:sequence select="xs:gDay($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:boolean'"><xsl:sequence select="xs:boolean($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:base64Binary'"><xsl:sequence select="xs:base64Binary($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:hexBinary'"><xsl:sequence select="xs:hexBinary($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:anyURI'"><xsl:sequence select="xs:anyURI($lexical)"/></xsl:when>
      <xsl:when test="$typeName eq 'xs:string'"><xsl:sequence select="$lexical"/></xsl:when>
      <xsl:otherwise><xsl:sequence select="xs:untypedAtomic($lexical)"/></xsl:otherwise>
    </xsl:choose>
  </xsl:function>

  <!-- xs:QName values are stored as a namespace URI plus local name, since a
       QName's lexical form alone cannot be resolved without an in-scope
       namespace context at parse time. -->
  <xsl:function name="zxd:cast-qname" as="xs:QName">
    <xsl:param name="uri" as="xs:string?"/>
    <xsl:param name="local" as="xs:string"/>
    <xsl:sequence select="if (string-length($uri) gt 0) then QName($uri, $local) else QName((), $local)"/>
  </xsl:function>

</xsl:stylesheet>
