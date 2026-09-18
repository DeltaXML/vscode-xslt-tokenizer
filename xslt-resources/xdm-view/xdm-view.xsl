<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                version="3.0">
     
     <!--
          (c) DeltaXignia ltd. 2026
          Single entry point for xdm-viewer: import this rather than the
          individual xdm-view-text.xsl/xdm-view-html.xsl files, the same way
          xdm-persistence.xsl is the entry point for that project.
     -->
     
     <xsl:import href="xdm-persistence.xsl"/>
     <xsl:import href="xdm-view-common.xsl"/>
     
     <xsl:import href="xdm-view-text.xsl"/>
     <xsl:import href="xdm-view-html.xsl"/>
     
</xsl:stylesheet>
