<xsl:stylesheet version="4.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" fixed-namespaces="#standard h=urn:g ./fixed-ns.xml">
  <xsl:function name="h:three" as="xs:integer">
    <xsl:sequence select="
      xs:integer(
        array:size([1, 2, 3]))"/>
  </xsl:function>
  <xsl:function name="d:name" as="xs:string"><xsl:sequence select="'d'"/></xsl:function>
</xsl:stylesheet>
