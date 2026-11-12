<?xml version="1.0" encoding="UTF-8"?>
<!--
  Validate with Schematron: the source document validated with a Schematron schema, as SchXslt2 - the Schematron
  processor bundled with XSpec - validates it, with one run of Saxon: the schema compiled to an XSLT 3.0 stylesheet by
  SchXslt2's transpiler, which is then run on the source document. The result is SchXslt2's SVRL report.
  With the schema's default phase - Saxon 13 fails with an internal error for transform()'s 'stylesheet-params'.
-->
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
  exclude-result-prefixes="#all">

  <!-- the schema's URI, and SchXslt2's transpile.xsl's -->
  <xsl:param name="schema" as="xs:string" required="yes"/>
  <xsl:param name="transpiler" as="xs:string" required="yes"/>

  <xsl:template match="/">
    <xsl:variable name="compiled" as="document-node()" select="transform(map {
        'stylesheet-location': $transpiler,
        'source-node': doc($schema)
      })?output"/>
    <!-- with the schema's URI as its base URI, for the modules its xsl:include and xsl:import bring in - the compiled
         stylesheet's own is that of the transpiler -->
    <xsl:variable name="rebased" as="document-node()">
      <xsl:document>
        <xsl:for-each select="$compiled/*">
          <xsl:copy>
            <xsl:attribute name="xml:base" select="$schema"/>
            <xsl:copy-of select="@* except @xml:base, node()"/>
          </xsl:copy>
        </xsl:for-each>
      </xsl:document>
    </xsl:variable>
    <xsl:sequence select="transform(map {
        'stylesheet-node': $rebased,
        'source-node': .
      })?output"/>
  </xsl:template>

</xsl:stylesheet>
