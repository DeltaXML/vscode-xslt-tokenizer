import * as path from 'path';

export class TestPaths {
    public static testDir = "__tests__";
    public static testDataDir = path.join(this.testDir, "data");
    public static testXslDataDir = path.join(this.testDataDir, "xsl-test-files");
}