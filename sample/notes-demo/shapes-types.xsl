<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:cx="http://example.com/shapes"
    exclude-result-prefixes="#all" version="4.0">

    <xsl:note format="xdoc-md">
        The **types** for the shapes demo: points, colours and shapes.

        Imported by `shapes-demo.xsl` - hover over its `xsl:import` to see this note.

        @author Demo Team
        @version 1.0
    </xsl:note>

    <xsl:item-type name="cx:point" as="record(x as xs:double, y as xs:double)">
        <xsl:note format="xdoc-md">
            A point on a plane.

            @field x the horizontal position, from the left
            @field y the vertical position, from the top
        </xsl:note>
    </xsl:item-type>

    <xsl:item-type name="cx:colour" as="enum('red', 'green', 'blue')">
        <xsl:note format="xdoc-md">
            A fill colour - one of the colours the renderer supports.
        </xsl:note>
    </xsl:item-type>

    <xsl:item-type name="cx:shape" as="record(name as xs:string, centre as cx:point, colour as cx:colour, size? as xs:double)">
        <xsl:note format="xdoc-md">
            A shape to draw.

            @field name the shape's name, e.g. `circle`
            @field centre the centre of the shape
            @field colour the fill colour
            @field size the size, in points - `1` if it's absent
            @since 1.0
        </xsl:note>
    </xsl:item-type>

</xsl:stylesheet>
