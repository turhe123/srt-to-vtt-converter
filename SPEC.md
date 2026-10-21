# SRT to VTT Subtitle Converter — specification

**Tagline:** Convert SRT subtitles to WebVTT and back in your browser, in batches, with nothing uploaded.

**Category:** Audio & Video

**Free alternative to:** Subtitle Converter sites such as Subtitle Tools and online SRT to VTT converters (upload your subtitle file to a server, ads, one file at a time)

**Search phrases:** srt to vtt, vtt to srt, convert srt to webvtt, subtitle converter, srt to vtt online, webvtt to srt, convert subtitles to vtt

**Allowed libraries:** none (browser APIs only)

**Published at:** https://turhe123.github.io/srt-to-vtt-converter/

## Acceptance checks (each must have a test)

- Loading sample.srt and choosing VTT outputs text starting with WEBVTT and using dots in timestamps
- Loading sample.vtt and choosing SRT outputs numbered cues with commas in timestamps
- Dropping three files at once produces three results and a ZIP-free list of download links
- A cue count and a warning list are displayed after conversion
- A binary file shows an error
- Works at 390px wide

## Spec

Anyone who publishes video on the web needs WebVTT, while desktop players, editors and download tools mostly produce SRT. So srt to vtt and vtt to srt are steady searches. The common converters upload the subtitle file to a server, show ads, handle one file at a time and often fail silently on odd encodings or byte order marks. Our version is a strict, transparent converter between the two formats.

Feature set: accept one or many files with extensions srt or vtt, or pasted text. Detect the input format from content, not only the extension. Convert SRT to VTT by adding the WEBVTT header, replacing the comma in timestamps with a dot, and dropping the numeric cue indexes optionally (default keep them as cue identifiers off). Convert VTT to SRT by removing the header, NOTE blocks, STYLE and REGION blocks, cue settings such as position and align, and numbering the cues from one. Handle timestamps without hours in VTT by adding zero hours. Show warnings when something was dropped or repaired, for example overlapping cues, empty cues or malformed times. Keep the text of each cue, including line breaks and basic tags.

UI: a large drop zone and a paste box side by side on wide screens, stacked on phones. A segmented control selects the target format with Auto as default, which means the opposite of the detected input. Below, each file is a card showing name, detected format, cue count, warnings and a Download button, plus a Copy button for the text and a read-only preview of the first lines. A Download all button saves each file separately in sequence. Output names replace the extension. Errors such as a non text file are shown on the card. Keyboard: Ctrl or Command V pastes into the box when it is focused, Enter converts.

Technical approach: read files with the File API as an ArrayBuffer and decode with TextDecoder, trying UTF-8 with BOM removal first, then UTF-16 based on the byte order mark, then Windows-1252 as a fallback. Parse with a line based state machine: split blocks on blank lines, find the line containing the arrow token between two timestamps using a tolerant regular expression, treat the remaining lines as text. Serialize with zero padded values. Normalize line endings to LF for VTT and keep CRLF as an option for SRT. Generate Blobs with UTF-8 encoding and use object URLs for downloads. Everything is plain string work, so no library or worker is needed, but run the loop in a single pass for files with tens of thousands of cues.

Edge cases: SRT files with a missing index, extra blank lines or timestamps using a dot, VTT with milliseconds of one or two digits, right to left languages, Unicode and emoji, cue text that contains the arrow token, very large files, and Mac line endings.

Demo data: a short fictional sample called Harbor Lights Trailer with six cues of English dialogue, once in SRT form and once in VTT form with a NOTE block and a position setting.
