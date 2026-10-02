<?xml version="1.0" encoding="UTF-8"?>
<!--
    A demo of XSLT 4.0 documentation notes - xsl:note format="xdoc-md" - with record and enumeration types.
    Run it with Saxon PE/EE 13 and syntax extensions, e.g. with Quick Run.

    Things to try:
    - hover over the start tag of the xsl:note below, for a preview of this module's note
    - hover over the href of the xsl:import, for the imported module's note
    - hover over $scale, $fill and $origin, for their documentation, from the module note or their own notes
    - hover over cx:area and cx:describe in the calls, and draw in the xsl:call-template, for their notes
    - hover over a field in a lookup, e.g. ?colour in $shape?colour, for its @field text
    - type $circle? in a select, for the fields of cx:shape with their @field text
    - Rename Symbol (F2) on a field, e.g. 'size', which renames it in shapes-types.xsl and its @field tag too
    - on the start tag of cx:perimeter, which has no note, choose 'Add documentation note' from the refactorings
    - within a note, type @ for the tags, and @param for the parameters not documented yet
-->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:math="http://www.w3.org/2005/xpath-functions/math"
    xmlns:cx="http://example.com/shapes"
    exclude-result-prefixes="#all" expand-text="yes" version="4.0">

    <xsl:note format="xdoc-md">
        Draws a few shapes, as text.

        @param $scale the scale factor for every shape's size
        @variable $origin the point all shapes are measured from
        @author Demo Team
        @version 1.0
    </xsl:note>

    <xsl:import href="shapes-types.xsl"/>

    <xsl:output method="text"/>

    <xsl:param name="scale" as="xs:double" select="1"/>

    <xsl:param name="fill" as="cx:colour" select="'blue'">
        <xsl:note format="xdoc-md">
            The fill colour for shapes that have none.

            A parameter can have a note of its own, for more detail than the module note's `@param`:
            - `red` for warnings
            - `green` for success
            - `blue` otherwise
        </xsl:note>
    </xsl:param>

    <xsl:variable name="origin" as="cx:point" select="{ 'x': 0, 'y': 0 }"/>

    <xsl:function name="cx:area" as="xs:double">
        <xsl:note format="xdoc-md">
            Returns the area of a shape, **scaled** by `$scale`.

            @param $shape the shape - a circle or a square
            @return the area, in square points
            @see cx:describe
            @since 1.0
        </xsl:note>
        <xsl:param name="shape" as="cx:shape"/>
        <xsl:variable name="size" as="xs:double" select="($shape?size, 1)[1] * $scale"/>
        <xsl:sequence select="if ($shape?name eq 'circle') then math:pi() * $size * $size else $size * $size"/>
    </xsl:function>

    <xsl:function name="cx:describe" as="xs:string">
        <xsl:note format="xdoc-md">
            Describes a shape: its colour, its name and where it is.

            @param $shape the shape
            @return a description, e.g. `a red circle at (1, 2)`
            @deprecated use the `draw` template, which also shows the distance from the origin
        </xsl:note>
        <xsl:param name="shape" as="cx:shape"/>
        <xsl:sequence select="'a ' || $shape?colour || ' ' || $shape?name || ' at (' || $shape?centre?x || ', ' || $shape?centre?y || ')'"/>
    </xsl:function>

    <xsl:function name="cx:perimeter" as="xs:double">
        <xsl:param name="shape" as="cx:shape"/>
        <xsl:sequence select="if ($shape?name eq 'circle') then 2 * math:pi() * ($shape?size, 1)[1] else 4 * ($shape?size, 1)[1]"/>
    </xsl:function>

    <xsl:template name="draw">
        <xsl:note format="xdoc-md">
            Draws a shape as a line of text.

            @param $shape the shape to draw
            @param $label a label to show before it
        </xsl:note>
        <xsl:param name="shape" as="cx:shape"/>
        <xsl:param name="label" as="xs:string" select="'shape'"/>
        <xsl:variable name="distance" as="xs:double" select="math:sqrt(math:pow($shape?centre?x - $origin?x, 2) + math:pow($shape?centre?y - $origin?y, 2))"/>
        <xsl:text>{$label}: {cx:describe($shape)}, area {format-number(cx:area($shape), '0.00')}, {format-number($distance, '0.00')} from the origin&#10;</xsl:text>
    </xsl:template>

    <xsl:template name="xsl:initial-template">
        <xsl:variable name="circle" as="cx:shape" select="{ 'name': 'circle', 'centre': { 'x': 3, 'y': 4 }, 'colour': 'red', 'size': 2 }"/>
        <xsl:variable name="square" as="cx:shape" select="{ 'name': 'square', 'centre': { 'x': 1, 'y': 1 }, 'colour': $fill }"/>
        <xsl:call-template name="draw">
            <xsl:with-param name="shape" select="$circle"/>
            <xsl:with-param name="label" select="'first'"/>
        </xsl:call-template>
        <xsl:call-template name="draw">
            <xsl:with-param name="shape" select="$square"/>
        </xsl:call-template>
        <xsl:text>perimeter of the circle: {format-number(cx:perimeter($circle), '0.00')}&#10;</xsl:text>
        <xsl:text>the circle's colour is {$circle?colour}&#10;</xsl:text>
    </xsl:template>

</xsl:stylesheet>
