# bruno-electron

```bash
# electron dev
npm start

# generate pfx file for signing windows build
openssl pkcs12 -export -inkey sectigo.key -in sectigo.pem -out sectigo.pfx
```

## macOS: "app is damaged" on unsigned DMG

Local / unsigned builds are not notarized. On the machine that built the DMG everything usually works, but after transfer (AirDrop, Drive, chat, etc.) Gatekeeper may quarantine the file and show that the package is damaged.

Clear quarantine on the DMG, then open it:

```bash
xattr -cr ~/Downloads/bruno_2.0.1_arm64_mac.dmg
```

If the app still fails after install:

```bash
xattr -cr /Applications/Bruno.app
```

Alternatively: right-click the `.app` → **Open** → confirm.

Proper distribution still needs Apple codesign + notarization.
