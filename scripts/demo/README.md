# Scripted demos for recording videos

A small development-only extension that plays the demos of the XSLT/XPath extension, step by step and the same way
each time, with a caption for each step. It isn't published: `scripts/**` is in `.vscodeignore`.

## Recording by hand (simplest)

Do every step yourself; the script just gives you a fresh workspace for each retake. From the terminal:

```sh
scripts/demo/reset-workspace.sh 1    # 1 or 2: debug-xpath.xsl and orders.xml; 3: the XSpec demo; 4: the packages demo
```

It empties `/Users/Shared/xslt-demo` - a path with no user name in it - and copies in fresh sample files - no `.vscode` folder, so no `tasks.json`, and no
generated XSpec results. Open that folder with the **Demo: Record Videos** launch configuration. Before a reset, close
the editors in that window (Cmd+K W); after it, run **Debug: Remove All Breakpoints** there if any are left. The
committed samples in `sample/` are never changed. For no user name anywhere on screen, also point the
`XSLT.tasks.saxonJar` setting at a copy of the Saxon jar outside your home folder, e.g. in `/Users/Shared/saxon/`: the
terminal shows the jar's path when a task runs.

The modes below - captions, step mode and automatic - are optional.

## Recording a video

1. Start the **Demo: Record Videos** launch configuration (Run and Debug view). It opens a window with the extension,
   this demo runner and the XSLT Dark Themes, in the demo's own folder, `scripts/demo/workspace` (not committed).
2. **Once only**, in that window: open `debug-xpath.xsl` and click **▶ Quick Run**, and choose a result file, e.g.
   `scripts/demo/workspace/out/result.xml`. Later runs offer it in a list, which the script accepts - the first run
   opens the save dialog, which a script can't use.
3. **Once only**: move the captions to the right. Click the **Demo** icon in the Activity Bar, then drag its
   **Captions** view into the secondary side bar (View › Appearance › Secondary Side Bar). It stays there, showing each
   step's caption in large text, while the Explorer and Run and Debug views change on the left.
4. Set up the window for recording: the window size, font size, theme, and Screencast Mode, if wanted.
5. Run **Demo: Reset for a Retake**: no editors open, fresh copies of the sample files, no `tasks.json`.
6. Start recording, then run **Demo: Play Video 1: Run and Debug a Stylesheet**. A 3-second countdown, then the steps.
7. For a retake: **Demo: Reset for a Retake**, and play again. **Demo: Stop** stops a take part-way.

## Captions only

The simplest mode: the demo shows captions and nothing else - you do each step yourself, as the caption says.

1. Run **Demo: Reset for a Retake** for a fresh folder, if you want one.
2. Run **Demo: Start Captions...** and pick a video. Its captions are in `captions/*.json`.
3. Start recording. Press **ctrl+alt+N** (**Demo: Next Step**) for each caption, and **ctrl+alt+B**
   (**Demo: Previous Step**) to go back one if you pressed too soon. The status bar shows **Demo 3/12**.

A captions file is a title and a list of steps - each a caption, with a note under it if wanted:

```json
{
	"title": "Video 1: Run and debug a stylesheet",
	"steps": [
		{ "caption": "Click ▶ Quick Run: no tasks.json, no setup", "note": "Pick a result file location, or press Enter..." },
		"A step that's just a caption"
	]
}
```

The file is read each time you start, so a change to it is used straight away - no reload. A new file in `captions/`
is offered too.

## Step mode

Instead of playing a video automatically, run **Demo: Start Video 1 in Step Mode**: it resets the folder, then each
press of **ctrl+alt+N** (**Demo: Next Step**) shows the next caption and does that step - so the pace is yours, with no
timing to go wrong, and no step can be missed. Choose the result file yourself when Quick Run or the debugger asks.
A press while a step is still running is ignored. The status bar shows **Demo 3/9**, with the next step in its tooltip.
For a retake, run **Demo: Start Video 1 in Step Mode** again.

## Changing a demo

The steps are in `demo.js`, one function per video. The pacing is in `PACE` at the top of the file, and
`SHOW_CAPTIONS` turns the captions off. Captions are shown in the Demo › Captions view, not as notifications, so they're never mixed up with the extension's own. `XSLT_DEMO_FAST=1` plays a demo quickly, to check that every step works.

The sample files are copied from `sample/` for each take, so the committed samples are never changed.

## The recording window (demo profile)

A separate VS Code profile, outside the home folder, so no user name appears in any path on screen - e.g. the
extension's own jar in a task's command line. Its settings, extensions and remembered choices are its own.

Open the demo workspace in it:

```sh
code --user-data-dir /Users/Shared/vscode-demo/data --extensions-dir /Users/Shared/vscode-demo/extensions /Users/Shared/xslt-demo
```

Install a new build of the extension into it, e.g. after `npx vsce package`:

```sh
code --user-data-dir /Users/Shared/vscode-demo/data --extensions-dir /Users/Shared/vscode-demo/extensions --install-extension xslt-xpath-2.2.0.vsix
```

Its settings are in `/Users/Shared/vscode-demo/data/User/settings.json`, e.g. `XSLT.tasks.saxonJar` set to a Saxon jar
outside the home folder.
