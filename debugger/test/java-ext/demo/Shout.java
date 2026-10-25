package demo;

import net.sf.saxon.expr.XPathContext;
import net.sf.saxon.lib.ExtensionFunctionCall;
import net.sf.saxon.lib.ExtensionFunctionDefinition;
import net.sf.saxon.om.Sequence;
import net.sf.saxon.om.StructuredQName;
import net.sf.saxon.trans.XPathException;
import net.sf.saxon.value.SequenceType;
import net.sf.saxon.value.StringValue;

// an integrated extension function, registered with a configuration file: d:shout('hi') gives 'HI!'
public class Shout extends ExtensionFunctionDefinition {
    public StructuredQName getFunctionQName() {
        return new StructuredQName("d", "urn:demo", "shout");
    }
    public SequenceType[] getArgumentTypes() {
        return new SequenceType[] { SequenceType.SINGLE_STRING };
    }
    public SequenceType getResultType(SequenceType[] suppliedArgumentTypes) {
        return SequenceType.SINGLE_STRING;
    }
    public ExtensionFunctionCall makeCallExpression() {
        return new ExtensionFunctionCall() {
            public Sequence call(XPathContext context, Sequence[] arguments) throws XPathException {
                return new StringValue(arguments[0].head().getStringValue().toUpperCase() + "!");
            }
        };
    }
}
