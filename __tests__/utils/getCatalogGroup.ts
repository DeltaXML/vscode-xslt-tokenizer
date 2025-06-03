import * as fs from 'fs';
import * as path from 'path';
import { CatalogGroup, ExpectedTokenData } from '../types';
import { TestPaths } from './testPaths';

export function getCatalogGroup(groupIndex: number) {
    const catalogPath = path.join(getLocalRootDir(), TestPaths.testXslDataDir, 'catalog.json');
    console.log("dirname", __dirname);
    console.log("catalogPath", catalogPath);
    console.log();
    const groupArray: Array<CatalogGroup> = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    return groupArray[groupIndex];
}
export function getDataFromFile(name: string) {
    const testDataFilePath = path.join(getLocalRootDir(), TestPaths.testDataDir, name + "-test.json");
    const testData: ExpectedTokenData = JSON.parse(fs.readFileSync(testDataFilePath, 'utf8'));
    return testData;
}

// for vscode-ext tests, the current directory is a subdirectory of 'out'
// so we have to go up one more level
function getLocalRootDir() {
    const dirname = __dirname;
    const isInsideOutDir = dirname.endsWith('/out/__tests__/utils');
    if (isInsideOutDir) {
        return path.join(__dirname, '../../../');
    } else {
        return path.join(__dirname, '../../');
    }

}
