# Releasing the extension

A checklist for publishing a new version of the XSLT/XPath extension (`deltaxml.xslt-xpath`) to the
Visual Studio Marketplace. Work through it in order; publishing is the last step and can't be undone for a
single version.

## 1. Version and release notes

1. Set `version` in `package.json` to the new version.
2. Add the release to the wiki's **Release Notes** page (`Release-Notes.md` in the
   `vscode-xslt-tokenizer.wiki` repo). `CHANGELOG.md` only links to that page, so it needs no change.

## 2. Docs

1. Update the docs pages for the release in the `deltaxml.github.io` repo: edit `vscode-xslt-xpath/authoring/<page>.xml`,
   never the HTML. Add the release to `authoring/new-release.xml`.
2. Regenerate every page from the repo root:

   ```
   java -cp ~/opt/SaxonPE13-1J/saxon-pe-13.1.jar net.sf.saxon.Transform \
     -xsl:vscode-xslt-xpath/xsl/createPages.xsl -s:vscode-xslt-xpath/authoring/layout.xml \
     -o:vscode-xslt-xpath/xslt-out/result1.xml
   ```

3. Check `git diff`: only the pages you meant to change should differ (ignore `xslt-out/result1.xml`).

4. Merge from `release` branch to `master` to publish the updated docs.

## 3. Tests

1. Unit tests: `npm run unit-test`
2. The full suite with a real Saxon jar for both groups of Saxon tests. Without the two variables, about 64
   tests are skipped (reported as pending):

   ```
   XSLT_TEST_SAXON_JAR=~/opt/SaxonPE13-1J/saxon-pe-13.1.jar \
   XSPEC_SAXON_JAR=~/opt/SaxonPE13-1J/saxon-pe-13.1.jar npm test
   ```

   Use the jar in `~/opt/SaxonPE13-1J`: it has the licence file beside it (the copy in `~/Downloads` doesn't).
3. Linux: `scripts/linux-tests/run.sh` (Docker).

## 4. Package and try it

1. `vsce package` (no token needed) - it compiles first through `vscode:prepublish`.
2. Install the `.vsix` in VS Code (**Extensions: Install from VSIX...**) and try the main features of the release.

## 5. Merge

1. The release branch is reviewed, then merged to `master`. Nothing goes to `master` before the review.
2. Push the docs and the wiki changes.

## 6. Publish (last)

vsce is kept logged out, so a mistyped `vsce publish` fails instead of releasing. The token (PAT) is in
1Password: **vsce api login - till aug 2027**.

1. `vsce ls-publishers` - it should print nothing (no saved token).
2. Copy the PAT from 1Password.
3. `VSCE_PAT=$(pbpaste) vsce verify-pat deltaxml` - it should say the verification succeeded.
4. `VSCE_PAT=$(pbpaste) vsce publish`

`$(pbpaste)` reads the clipboard, so the token isn't shown or saved in the shell's history. 1Password clears
the clipboard after 90 seconds: copy it again if a step takes longer.

If the token has expired, make a new one at dev.azure.com, under User settings, Personal access tokens:
organization **All accessible organizations**, scope **Marketplace: Manage**. Save it, with its expiry date,
in the 1Password item. Never use `vsce login`: it saves the token again.

An accidental release can't be withdrawn on its own: `vsce unpublish` removes the whole extension. Publish
a fixed release with a higher version instead.
