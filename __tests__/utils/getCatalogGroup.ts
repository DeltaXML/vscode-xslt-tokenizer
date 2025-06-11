import * as fs from 'fs';
import * as path from 'path';
import { CatalogGroup, ExpectedProblemData, ExpectedTokenData } from '../types';
import { TestPaths } from './testPaths';

export function getCatalogGroup(groupIndex: number) {
    const catalogPath = path.join(getLocalRootDir(), TestPaths.testXslDataDir, 'catalog.json');
    console.log('');
    console.log('===== Catalog =======');
    console.log("Path:", catalogPath);
    const groupArray: Array<CatalogGroup> = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    console.log(`Group: '${groupArray[groupIndex].group}'`);
    console.log(`Group-Index: ${groupIndex}`);
    console.log();
    return groupArray[groupIndex];
}
export function getTokenDataFromFile(name: string) {
    const testDataFilePath = path.join(getLocalRootDir(), TestPaths.testDataDir, name + "-test.json");
    const testData: ExpectedTokenData = JSON.parse(fs.readFileSync(testDataFilePath, 'utf8'));
    return testData;
}

export function getProblemDataFromFile(name: string) {
    const testDataFilePath = path.join(getLocalRootDir(), TestPaths.testDataDir, name + "-test.json");
    const testData: ExpectedProblemData = JSON.parse(fs.readFileSync(testDataFilePath, 'utf8'));
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
