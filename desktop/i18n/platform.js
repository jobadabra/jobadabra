// The window's words are written for the Mac; on Windows these swaps name the PC's equivalents. Order matters: the
// two-key combinations are swapped before their second key alone (⌘⇧G before ⌘G), and the bare ⌘ last.
/** Read the app platform from preload, falling back to Node only outside the renderer. */
export const hostPlatform = () => globalThis.window?.pilot?.platform ?? globalThis.process?.platform;

const WINDOWS = [
  [/your Mac[’']s Keychain/g, "Windows' built-in encryption"],   // the straight and the curly apostrophe: both are in the window's text
  [/\b(this|the) Mac[’']s Keychain\b/gi, 'Windows Credential Manager'],   // the PC's secret store (src/secret_store.py: keyring)
  [/\b(this|my|your|the) Mac\b/gi, '$1 PC'],   // case kept as written: "This Mac's version" -> "This PC's version"
  [/\bKeychain\b/g, 'Windows Credential Manager'],
  [/Show in Finder/g, 'Show in File Explorer'],
  [/in Finder\b/g, 'in File Explorer'],
  [/⌘-click/g, 'Ctrl-click'],
  [/[⌘]⇧G|⇧⌘G/g, 'Ctrl+Shift+G'],
  [/⌘K/g, 'Ctrl+K'],
  [/⌘R/g, 'Ctrl+R'],
  [/⌘L/g, 'Ctrl+L'],
  [/⌘V/g, 'Ctrl+V'],
  [/⌘G/g, 'Ctrl+G'],
  [/⇧Enter/g, 'Shift+Enter'],
  [/⏎/g, 'Enter'],
  [/⌘/g, 'Ctrl+'],
];

/** Adapt trusted app-authored platform wording; never pass interpolated personal content. */
export function osText(text, platform) {
  return platform === 'win32' ? WINDOWS.reduce((out, [from, to]) => out.replace(from, to), String(text)) : text;
}

// A whole sentence that differs by platform, where swapping words won't do: "Load unpacked, then ⌘⇧G" has no PC
// equivalent at all (its folder dialog has no Go to Folder), so the PC gets its own instruction.
/** Select an explicit app-authored instruction for the operating system. */
export const pick = (mac, windows, platform) => (platform === 'win32' ? windows : mac);

