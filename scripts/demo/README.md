# Scripted demos for recording videos

A small development-only extension that plays the demos of the XSLT/XPath extension, step by step and the same way
each time, with a caption for each step. It isn't published: `scripts/**` is in `.vscodeignore`.

## Recording a video

1. Start the **Demo: Record Videos** launch configuration (Run and Debug view). It opens a window with the extension,
   this demo runner and the XSLT Dark Themes, in the demo's own folder, `scripts/demo/workspace` (not committed).
2. **Once only**, in that window: open `debug-xpath.xsl` and click **▶ Quick Run**, and choose a result file, e.g.
   `scripts/demo/workspace/out/result.xml`. Later runs offer it in a list, which the script accepts - the first run
   opens the save dialog, which a script can't use.
3. Set up the window for recording: the window size, font size, theme, and Screencast Mode, if wanted.
4. Run **Demo: Reset for a Retake**: no editors open, fresh copies of the sample files, no `tasks.json`.
5. Start recording, then run **Demo: Play Video 1: Run and Debug a Stylesheet**. A 3-second countdown, then the steps.
6. For a retake: **Demo: Reset for a Retake**, and play again. **Demo: Stop** stops a take part-way.

## Changing a demo

The steps are in `demo.js`, one function per video. The pacing is in `PACE` at the top of the file, and
`SHOW_CAPTIONS` turns the captions off. `XSLT_DEMO_FAST=1` plays a demo quickly, to check that every step works.

The sample files are copied from `sample/` for each take, so the committed samples are never changed.
