<?xml version="1.0" encoding="UTF-8"?>
<!--
  A stylesheet's timing profile (Saxon's -TPxsl:profile-xml.xsl output) as plain text, for an AI assistant to read: the
  templates, functions and global variables that took the most time, ranked by NET time - the time in the construct itself,
  not in what it calls - each with its calls, gross time (including what it calls) and where it is declared.
  With -repeat:N Saxon writes a trace for each run, and the first includes the Java VM's start-up and warm-up, so it is left
  out: the times are the average of the others (as in the Profile view of the extension). Times are in milliseconds.
  Saxon times templates, functions and globals, not lines inside them: the line is where the declaration's start tag ends.
  Saxon writes a trace for each run one after another, with no root element around them, so the file is read as text, not as
  the source document: run with -it:main and profile=the file.
  Parameters (as name=value on the command line, e.g. top=30):
    profile  the profile file (-TP:file, with -TPxsl:profile-xml.xsl)
    top   how many rows to show - 15 by default; 0 for all
    base  a folder (ending in /): modules under it are shown relative to it
  Run with the Saxon jar: java -cp saxon.jar net.sf.saxon.Transform -it:main -xsl:profile-summary.xsl profile=profile.xml
-->
<xsl:stylesheet version="3.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:f="urn:xslt-xpath:profile-summary" exclude-result-prefixes="#all">

  <xsl:output method="text"/>

  <xsl:param name="profile" as="xs:string" required="yes"/>
  <xsl:param name="top" as="xs:integer" select="15"/>
  <xsl:param name="base" as="xs:string" select="''"/>

  <xsl:function name="f:ms" as="xs:string">
    <xsl:param name="value" as="xs:double"/>
    <xsl:sequence select="format-number($value, if ($value ge 10) then '#,##0.0' else '#,##0.00#')"/>
  </xsl:function>

  <xsl:function name="f:key" as="xs:string">
    <xsl:param name="fn" as="element(fn)"/>
    <xsl:sequence select="string-join(($fn/@construct, $fn/@name, $fn/@match, $fn/@file, $fn/@line), '|')"/>
  </xsl:function>

  <!-- the module: its path, relative to $base if under it -->
  <xsl:function name="f:module" as="xs:string">
    <xsl:param name="uri" as="xs:string"/>
    <xsl:variable name="path" as="xs:string" select="substring-after($uri, 'file:') => replace('^//(/)?', '/') => replace('^/([A-Za-z]:)', '$1') => f:decode()"/>
    <xsl:sequence select="if ($base ne '' and starts-with($path, $base)) then substring-after($path, $base) else $path"/>
  </xsl:function>

  <!-- a space is the escape that file URIs have in the paths of most projects; others are left as they are -->
  <xsl:function name="f:decode" as="xs:string">
    <xsl:param name="path" as="xs:string"/>
    <xsl:sequence select="replace($path, '%20', ' ')"/>
  </xsl:function>

  <xsl:function name="f:label" as="xs:string">
    <xsl:param name="fn" as="element(fn)"/>
    <xsl:variable name="what" as="xs:string" select="substring-after($fn/@construct, 'xsl:')"/>
    <xsl:variable name="name" as="xs:string" select="($fn/@name, $fn/@match)[1]"/>
    <xsl:sequence select="$what || ' ' || (if ($fn/@match and string-length($name) gt 90) then substring($name, 1, 87) || '...' else $name)"/>
  </xsl:function>

  <xsl:template name="main">
    <xsl:variable name="traces" as="element(trace)*" select="parse-xml-fragment(unparsed-text($profile))/trace"/>
    <xsl:if test="empty($traces)">
      <xsl:message terminate="yes">No profile in this file: it has no trace elements - was Saxon run with -TP and -TPxsl?</xsl:message>
    </xsl:if>
    <!-- the first run is the Java VM's warm-up, if there are more -->
    <xsl:variable name="used" as="element(trace)+" select="if (count($traces) gt 1) then tail($traces) else $traces"/>
    <xsl:variable name="n" as="xs:integer" select="count($used)"/>
    <xsl:variable name="total" as="xs:double" select="sum($used/@t-total) div $n"/>
    <xsl:variable name="rows" as="element(row)*">
      <xsl:for-each-group select="$used/fn" group-by="f:key(.)">
        <row net="{sum(current-group()/@t-sum-net) div $n}" gross="{sum(current-group()/@t-sum) div $n}"
             count="{sum(current-group()/@count) div $n}" label="{f:label(.)}"
             where="{f:module(@file)}:{@line}"/>
      </xsl:for-each-group>
    </xsl:variable>
    <xsl:variable name="ranked" as="element(row)*" select="sort($rows, (), function($r) { -xs:double($r/@net) })"/>
    <xsl:variable name="netTotal" as="xs:double" select="sum($rows/@net ! xs:double(.))"/>
    <xsl:variable name="shown" as="element(row)*" select="if ($top gt 0) then subsequence($ranked, 1, $top) else $ranked"/>

    <xsl:value-of select="'Profile: ' || (if (count($traces) eq 1) then '1 run (it includes the Java VM''s warm-up - use -repeat:N, N of 3 or more, for steadier times)'
        else 'average of runs 2-' || count($traces) || ', after a warm-up run') || '; total ' || f:ms($total) || ' ms&#10;'"/>
    <xsl:value-of select="'Ranked by net time (in the construct itself, not in what it calls); gross includes what it calls. Times in ms.&#10;'"/>
    <xsl:for-each select="$shown">
      <xsl:variable name="net" as="xs:double" select="@net"/>
      <xsl:value-of select="f:ms($net) || ' net  ' || (if ($netTotal gt 0) then format-number($net div $netTotal, '0%') else '0%') || '  ' ||
        f:ms(@gross) || ' gross  ' || format-number(xs:double(@count), '#,##0') || ' calls  ' || @label || '  ' || @where || '&#10;'"/>
    </xsl:for-each>
    <xsl:if test="count($ranked) gt count($shown)">
      <xsl:value-of select="'... ' || (count($ranked) - count($shown)) || ' more, with a total of ' ||
        f:ms(sum(subsequence($ranked, count($shown) + 1) ! xs:double(@net))) || ' ms net (top=0 shows all)&#10;'"/>
    </xsl:if>
    <xsl:value-of select="'Percentages are of the net times shown and not shown, ' || f:ms($netTotal) || ' ms; the rest of the total is outside templates, functions and globals (parsing the source, serializing).&#10;'"/>
  </xsl:template>
</xsl:stylesheet>
