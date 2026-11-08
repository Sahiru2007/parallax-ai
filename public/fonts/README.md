# Bundled Parallax fonts

The app serves these unmodified font files from its own `/fonts/` directory. It does not request a font CDN at runtime.

| Family           | Included weights | Use                                                            |
| ---------------- | ---------------- | -------------------------------------------------------------- |
| Barlow           | 400, 500         | Interface, conversation, forms and controls                    |
| Barlow Condensed | 500              | Wordmark and main headings                                     |
| IBM Plex Mono    | 400, 500         | Source, commands, paths, model IDs, times and timeline details |

Files were obtained from the [official Google Fonts repository](https://github.com/google/fonts), pinned to revision `5bb28733cec313b63fbd415b574b5ae35c8aa8b8`. `manifest.json` records each exact upstream URL, byte count and SHA-256 digest.

The original license files are retained beside each family: [Barlow](https://github.com/google/fonts/blob/5bb28733cec313b63fbd415b574b5ae35c8aa8b8/ofl/barlow/OFL.txt), [Barlow Condensed](https://github.com/google/fonts/blob/5bb28733cec313b63fbd415b574b5ae35c8aa8b8/ofl/barlowcondensed/OFL.txt), [IBM Plex Mono](https://github.com/google/fonts/blob/5bb28733cec313b63fbd415b574b5ae35c8aa8b8/ofl/ibmplexmono/OFL.txt).

`src/styles/typography.css` defines the five local faces and shared typography/color tokens. Browser and production tests block external network requests and verify all five exact family/weight faces load successfully.
