import * as path from 'path';

export class TestPaths {
    public static testDir = "__tests__";
    public static testDataDir = path.join(this.testDir, "data");
}