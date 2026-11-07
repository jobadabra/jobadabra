# Settings

- [settings-1] Every "Settings → X" path the app prints is a real path, for example "Settings → Connections → AI". | source: desktop/test/guards/rules/settings-paths-exist.test.js | code: -
- [settings-2] Every mention of AI credit says what it buys ("about N applications or N searches"). | source: desktop/test/guards/money/credit-buys.test.js | code: -
- [settings-3] A row such as "Always on: your GitHub" names a setting and the value beside it is that setting's state ("Off — runs while the app is open"); the label does not claim the setting is on. | source: desktop/renderer/index.html | code: desktop/renderer/index.html, desktop/renderer/pages/settings.js
- [settings-4] "View backups" opens the backup folder in the system file manager; the Settings page itself does not change, and no backup details open inside the app. | source: owner yes, 5 Nov 2026 (via the coordinator) | code: desktop/lib/system-handlers.js
- [settings-5] The text-size setting prints the real page zoom next to the choice's own words, and "Default" is not always 100%: on a laptop-size screen Default is 80%, so "Large" reads "100%. Bigger text, easier to read."; only on a big screen is 100% the Default. | source: closed #3531 (7 Nov 2026, by design) | code: desktop/lib/zoom.js, desktop/renderer/pages/text-size.js
