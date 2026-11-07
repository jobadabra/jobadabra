# App icon

- `icon.png`: the artwork (1024 px, the twin's Dock icon and the Windows icon). `win.icon` still points at it.
- `icon.icon`: the same artwork as an Icon Composer icon for the Mac build (`mac.icon` in `package.json`). A flat yellow fill plus one dark layer (the hat, star and J, cut out of `icon.png`), glass, shadow, specular and translucency off, dark appearance the same yellow.

Why (7 Nov 2026, owner: "I'd like to have the twin icon everywhere"; #3366): on macOS 26 an icon read from a bundle's file (`icon.icns`, or a PNG) goes through the system's legacy-icon treatment: the dark shapes turn translucent brown, the edge glows, the whole icon is soft. The twin looked crisp only because `app.dock.setIcon` hands the system an image at runtime. An Icon Composer icon is compiled into `Assets.car` and named by `CFBundleIconName`, which the system draws as a native icon, on every surface (Dock, Finder, Launchpad, Cmd-Tab).

- Building the Mac app needs `actool` from Xcode 26 or later (electron-builder runs it); the release runner (`macos-latest`, macOS 26 image, Xcode 26.6) has it. A Mac with only the Command Line Tools cannot run `npm run build`.
- The release job checks the built app carries `Assets.car` and `CFBundleIconName` (`.github/workflows/desktop.yml`, Compile step).
- To redraw: change `icon.png`, regenerate the layer (the dark part only, alpha = how dark, cropped to the 824 px square and scaled to 1024), keep the fill the same yellow.
