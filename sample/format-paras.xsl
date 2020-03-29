<xsl:template match="book">
    <trial>this is goind
        to be difficult       
        and so is this</trial>
    <new>
        this is quite
        new to this also
        <![CDATA[some CDATA
        is going to make thing awkward]]>
        and again
        difficult
    </new>
    <xsl:text>
    keep indents
        inside
        xsl:text
    because this is the convention
    </xsl:text>
    <demo xml:space="preserve">
      keep
        this
          indent
        <demo2 xml:space="none">
            and observe
            preserv-space
        </demo2>
    </demo>
</xsl:template>