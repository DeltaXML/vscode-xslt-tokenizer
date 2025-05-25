import * as assert from 'assert';
import * as vscode from 'vscode';

describe('VSCode Extension Host Smoke Test', function () {
  // The extension host can take a while to start
  this.timeout(10000);

  it('should activate the extension', async () => {
    const extension = vscode.extensions.getExtension('deltaxml.xslt-xpath');
    assert.ok(extension, 'Extension not found');
    await extension!.activate();
    assert.strictEqual(extension!.isActive, true, 'Extension did not activate');
  });

  it('should have the XSLT/XPath language registered', () => {
    const languages = vscode.languages.getLanguages();
    // This is async, but for a smoke test, just check the promise resolves
    return languages.then(list => {
      assert.ok(list.includes('xslt'), 'xslt language not registered');
      assert.ok(list.includes('xpath'), 'xpath language not registered');
    });
  });
});
