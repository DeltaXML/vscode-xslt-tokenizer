<?xml version="1.0" encoding="UTF-8"?>
<!--
    Used by 'XSLT: Profile Stylesheet' as Saxon's -TPxsl stylesheet: Saxon applies it to its timing profile data, and
    this copies the data unchanged, as XML - instead of Saxon's own HTML report. The extension reads it (see
    src/xsltProfile.ts) and shows it in the Profile view.
-->
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:mode on-no-match="shallow-copy"/>
  <xsl:output method="xml" indent="yes"/>
</xsl:stylesheet>
