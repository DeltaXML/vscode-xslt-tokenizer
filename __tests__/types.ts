export interface TestDataType {
    suite: string;
    description: string;
    tests: Array<{
        label: string;
        xpath: string;
        tokens: Array<[string, string]>;
    }>;
}

export interface RawLexerTestData {
  suite: string;
  descriptor: string;
  testCases: [string, string][];
}