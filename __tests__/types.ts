export interface ExpectedTokenData {
  suite: string;
  description: string;
  source: string;
  attributeName: string;
  // the version attribute of the source XSLT, when this is not '3.0'
  xsltVersion?: string;
  tests: Array<{
    label: string;
    xpath: string;
    tokens: Array<[string, string]>;
  }>;
}

export interface ExpectedProblemData {
  suite: string;
  description: string;
  source: string;
  attributeName: string;
  xsltVersion?: string;
  tests: Array<ProblemTest>;
}

export interface ProblemTest {
    label: string;
    xpath: string;
    problems?: Array<[string, string]>;
    tokens?: any;
}

export interface RawLexerTestData {
  suite: string;
  source: string;
  attributeName: string;
  description: string;
  xsltVersion?: string;
  testCases: [string, string][];
}

export interface CatalogGroup {
    group: string;
    files: string[];
}
