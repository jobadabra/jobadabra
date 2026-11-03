# The Keychain item becomes "Jobadabra Safe Storage", tokens moved

> **Verdict:** macOS asks for "Job Pilotto Safe Storage" because `app-identity.js` pinned the old name so saved tokens stayed readable (25 Oct 2026). One start after the update reads every saved token with the old key, locks it again under **"Jobadabra Safe Storage"**, checks them all, and only then records the move. The old item is **kept untouched** as a backup. Any failure keeps the old name and the old values and tries again next start; a token is never lost.

**Owner's words (3 Nov 2026):** "It still points to Job PIlotto keychain/secrests... It shuold be Jobadabra." Choice: "Yes, with a migration (Recommended)": one run reads every saved token with the old key, locks it again under the new item, checks them all, then stops using the old item (kept as a backup for one release); a short spec and a test on a fake keychain; one last prompt for the old item during the move is acceptable.
**Who gets what:** every Mac user sees "Jobadabra Safe Storage" (not the old app name) in Keychain Access and in the macOS prompt, and keeps every token (Notion, AI keys, Telegram, extension token). No visible screen changes.

## Problem

Electron seals `secrets.json` with `safeStorage`; on macOS that is Chromium's OSCrypt over one Keychain item. Its name is `<app name> Safe Storage` (account `<app name>`), fixed the first time the process seals. `desktop/lib/app-identity.js` `keepLegacyIdentity` names the app "Job Pilotto Safe Storage"'s app name (the old one) for that first seal and "Jobadabra" afterwards. Renaming the item the plain way (`app.setName('Jobadabra')`) makes a **new, empty key**: every sealed value in `secrets.json` becomes unreadable (the app treats it as missing and asks again). One process cannot use two items (the name is fixed at the first seal), so the old key cannot be reached through `safeStorage` after the rename.

## How the key is made (read from the source, Electron v44.4.5 / Chromium main, 3 Nov 2026)

| Fact | Source |
|---|---|
| Item service `<app name> Safe Storage`, account `<app name>` | electron `shell/browser/electron_browser_main_parts.cc` (`KeychainPassword::GetServiceName() = app_name + " Safe Storage"`) |
| The item's value is the **password**: 16 random bytes, base64 text, used as the UTF-8 bytes of that string | chromium `components/os_crypt/common/keychain_password_mac.mm` (`AddRandomPasswordToKeychain`) |
| Key = PBKDF2-HMAC-SHA1(password, salt `saltysalt`, 1003 iterations) → 16 bytes | `components/os_crypt/async/browser/keychain_key_provider.mm` (constants "duplicated from the sync backend os_crypt_mac.mm") |
| Cipher AES-128-CBC, PKCS#7, fixed IV = 16 spaces; stored value = `"v10"` + ciphertext; the app stores it base64 | `components/os_crypt/async/common/encryptor.cc` (`kFixedIvForAes128Cbc`, key tag `v10`), `desktop/lib/storage.js` (`toString('base64')`) |
| Electron's `safeStorage.encryptString`/`decryptString` call `OSCrypt` directly, no extra header | electron `shell/browser/api/electron_api_safe_storage.cc` |

Same key + same fixed IV means the same plaintext seals to the **same bytes**. The move uses that as a detector (see "Verdicts").

Windows (DPAPI) and Linux (libsecret/kwallet): on **Windows** the key is wrapped by DPAPI and kept in Chromium's `Local State`; **no name exists**, so there is nothing to rename and that path is unchanged. **Linux** is not a shipping platform (CI uses plain text); its path stays exactly as today (`TODO(AI)` in the code: a Linux keyring item would need the same move if Linux ever ships).

## Observable behaviour

- A fresh Mac install starts on "Jobadabra Safe Storage"; the old item is neither read nor made.
- An existing install, first start after the update: macOS shows **one** prompt from `security` ("wants to use your confidential information stored in 'Job Pilotto Safe Storage'"); after it, every token still works; the macOS prompt that names "Job Pilotto Safe Storage" never appears again.
- Second start: no prompt for the old item, nothing re-sealed.
- If the person presses Deny: the app starts as today (old name, all tokens work) and asks again next start.
- No notice, no setting, no screen (a notice would need the owner's yes first).

## States (one owner: `desktop/lib/keychain-migration.js`)

The state lives **in `secrets.json` itself** as the reserved entry `"__sealedBy": "Jobadabra Safe Storage"`, so the new values and the "moved" record are one atomic rename: the file always says which item sealed it (two files could disagree after a crash between the two writes).

| State | How it is recognised | Process name at first seal | Verdict that leaves it |
|---|---|---|---|
| **not migrated** | `secrets.json` has sealed values and no `__sealedBy` | the old app name (as today) | the move runs at app ready (below) |
| **migrating** | inside one synchronous call at ready, before the storage exists | "Jobadabra" once the old values are read | all values re-sealed **and** read back equal → write file (temp + fsync + rename) → **migrated**; anything else → **failed-keep-old** |
| **migrated** | `__sealedBy` = "Jobadabra Safe Storage" | "Jobadabra" | none (final) |
| **failed-keep-old** | the move threw or a check failed; `secrets.json` untouched | see failure rules | next start is **not migrated** again |
| **fresh** | `secrets.json` missing or empty | "Jobadabra" | the start writes `__sealedBy` at once, so a later start never mistakes the new item's values for old ones |

**When it runs:** at app ready, in the **first copy only** (a second copy quits at once and must not prompt or rewrite the file), after a Reset or Import has been applied (`reset.applyPending` runs between load and ready, so the plan is read from the folder as it is *then*; reading it at load would write an old install's tokens back into a freshly reset folder, or leave a reset install's new tokens unreadable) and before anything seals. Review of 3 Nov 2026 found this; the tests "Reset between load and ready", "Reset of an install already moved", "Import into a moved install" and "a second copy" play it. An Import of an export sealed under the old item (no record) is simply "not migrated" again and is moved the same way.

The move, in order (nothing is written before step 4):
1. Read the old item's password with `security find-generic-password -w -s "Job Pilotto Safe Storage" -a "Job Pilotto"` (the one prompt; 120 s limit). Error or Deny → failed-keep-old, **before** the process left the old name: the app runs as today.
2. Derive the old key; decrypt every sealed value in Node (the key, then Chromium's own empty-password fallback key, as `encryptor.cc` does). A value that does not decrypt is left as it is (unreadable now, unreadable after; same as today); the log says "N of M moved". If values exist and **none** decrypt, the key or the method is wrong → failed-keep-old.
3. `app.setName("Jobadabra")`, then seal each plaintext with `safeStorage`, then decrypt each again and compare. A sealed value **equal** to its old bytes means Electron is still on the old key (the name did not take) → failed-keep-old.
4. Copy the old file to `secrets.before-keychain-move.json` (0600, kept one release), then write the new `secrets.json` with `__sealedBy` in one rename. A failed write → failed-keep-old.
5. Log one line (counts only, never a value).

## Failure rules

- Steps 1–2 fail: nothing changed in the process; `safeStorage` stays on the old item, exactly today's behaviour. Log the cause; retry next start.
- Steps 3–4 fail: the process may already be bound to the new item, so it cannot read old values through `safeStorage`. For this session the app uses **the same Node code with the old key it already holds** (it reads and writes the old format): every token stays readable, `secrets.json` is untouched, a token saved meanwhile is sealed the old way and the next start moves it too.
- A crash at any point leaves either the old file (still old-sealed, no marker) or the new one (new-sealed, marker): never a mix.
- The old Keychain item is **never deleted or changed** in this change; deleting it is a later release's decision.
- Secrets in memory only; never in a log; the old password is dropped when the move ends.

## Why macOS may ask again after an update (not changed here)

A Keychain item's access list trusts the **code signature** of the app that made it. An update whose signature differs (an unstable or ad-hoc signature, a changed identity) is a different requester, so macOS asks again. This change moves the tokens to a new item the **current** build creates and trusts; it does not make the signature stable. That is a release/signing matter.

## Known effects and limits

- **The in-app Notion window is signed out once.** Chromium encrypts that window's cookies (`persist:notion`) with the same Keychain key; after the move they cannot be opened, so the person signs in to Notion again in that window. The Notion *token* (API) is moved and unaffected. Every other window is in-memory (`linkedin-signin`, `jobadabra-render`). Not migrated (Chromium's cookie database is not ours to rewrite).
- **The prompt blocks the start.** The old item is read with `execFileSync` (120 s limit) before the window opens, once per install (and again after a Deny). An async read would need `start()` to wait; not worth it for a one-time prompt.
- **A downgrade after the move** (an older build) keeps the `__sealedBy` record, seals new values under the old item, and a later update then reads them as unreadable. Downgrades are not supported.
- **Evidence that the name can be changed after load (the one thing no test can prove):** the installed 0.9.6 bundle's `CFBundleName` is "Jobadabra" (`plutil -p`), yet the owner's prompt names "Job Pilotto Safe Storage": so today's the old `app.setName` *does* decide the item after load, and `app.setName("Jobadabra")` decides it the same way. If it ever did not, the move detects it (the re-sealed bytes equal the old ones), keeps the old values and retries next start. The owner's check after the update is the proof on a real Keychain.

## Non-goals

- The data folder does not move (`~/Library/Application Support/Jobadabra` rule stays as is: rebrand step 2's other half); `userData` is set exactly as before.
- `appId`, `productName` and the Windows/Linux paths are untouched.
- `adoptBackupKeys` (a backup folder of the same Profile lends keys to an import of an export made before 8 Oct 2026) copies values sealed with the old key; they read as unreadable and the app asks again. Rare, nothing lost (the old item is kept): parked in Linear.
- Tests and demo runs (`JOBADABRA_USER_DATA`, demo folder) keep the old path, so a test never creates a Keychain item in the owner's login keychain.

## Tests (a fake keychain and a fake `safeStorage`, no real Keychain)

`desktop/test/keychain-migration.test.js`: the fake `safeStorage` fixes its key at the first seal from `app.name`, like Electron; the fake `security` serves a map of items.
1. Known answer: a value sealed by OpenSSL (independent of our code) opens, and our sealing equals it.
2. The owner's update: a store sealed by the old build (the old app name) with 3 tokens → the new start → every token reads back through the new item; the old Keychain item unchanged; `secrets.json` carries `__sealedBy`.
3. Second start: no `security` call, no re-seal.
4. Deny / error at step 1: nothing written, tokens readable under the old name, retried next start.
5. A failure after the name changed (second seal throws; the rename fails; the name does not take): tokens readable, file byte-identical, a later start moves them.
6. Fresh install: no `security` call, first seal under "Jobadabra", marker written.
7. `app-identity.test.js`: the Keychain test now asserts the new rule (Why: owner's words of 3 Nov 2026).

## Progress
- [x] Read the source for the macOS key derivation and the name (proof: docs/superpowers/specs/2026-11-03-keychain-jobadabra-design.md)
- [x] Spec (proof: docs/superpowers/specs/2026-11-03-keychain-jobadabra-design.md)
- [x] `desktop/lib/keychain-migration.js` + `app-identity.js` + `main.js` wiring (proof: desktop/lib/keychain-migration.js)
- [x] Tests on a fake keychain (proof: desktop/test/keychain-migration.test.js)
- [ ] Behaviour PR: fresh `/code-review`, Gitar approved, owner merges (proof: none: the PR)
- [ ] The owner tries it on his Mac after the update: Keychain Access shows "Jobadabra Safe Storage", tokens work (proof: none: the owner's check; no session touches the real Keychain)
- [ ] Later release: decide whether the old item is deleted (proof: none: a later decision)
