# StockBolt Android — release runbook

The Android app wraps the same React build and the same Supabase project as
stockbolt.online: same logins, same companies, same records. Releasing the
app never touches the website or the database.

## One-time setup

### 1. Create the release signing key (Rashid, once, ever)

Every update must be signed with this same key. Lose it and installed apps
can never be updated — clients would have to uninstall (losing nothing on the
server, but it is a support mess). Keep two backups (e.g. USB drive + Google
Drive) and the passwords in a password manager.

Open a terminal and run (it asks for a password and your name/company):

```
mkdir C:\Users\rashi\StockBoltKeys
"C:\Users\rashi\.jdks\jbr-21.0.11\bin\keytool.exe" -genkeypair -v -keystore C:\Users\rashi\StockBoltKeys\stockbolt-release.jks -alias stockbolt -keyalg RSA -keysize 4096 -validity 10000
```

The key lives OUTSIDE the repo. Never commit it, never email it.

### 2. Tell the build where the key is

Create `android/keystore.properties` (git-ignored) with your own passwords:

```
storeFile=C:/Users/rashi/StockBoltKeys/stockbolt-release.jks
storePassword=YOUR_KEYSTORE_PASSWORD
keyAlias=stockbolt
keyPassword=YOUR_KEY_PASSWORD
```

### 3. Supabase: allow Google sign-in to return to the app

Supabase → Authentication → URL Configuration → Redirect URLs → Add
`online.stockbolt.app://auth-callback` → Save.

## Every release

1. Bump `versionCode` (+1) and `versionName` in `android/app/build.gradle`.
2. Build:
   ```
   npm run build
   npx cap sync android
   cd android
   gradlew assembleRelease
   ```
3. Verify the signature:
   ```
   %ANDROID_HOME%\build-tools\<version>\apksigner verify --print-certs app\build\outputs\apk\release\app-release.apk
   ```
   The SHA-256 must be the same as every previous release:
   `46:37:10:34:64:b4:a1:aa:e1:db:5f:91:6a:87:9b:df:80:d0:26:d5:56:42:7c:61:5c:97:36:05:b2:0a:9f:f9`
   (first release 1.0.0, 2026-10-29). A different value means the wrong key.
4. Smoke test on a phone: install over the previous version (must update in
   place, still signed in), sign in with email and Google, open an invoice,
   Share PDF, Back button, export a report.
5. Distribute `app-release.apk` (renamed `StockBolt-<versionName>.apk`).

## Notes

- Debug APKs (signed with this PC's debug key) can't be upgraded by release
  APKs. Clients get release builds only; uninstall a test build first.
- Database changes must stay backward compatible: an older installed app keeps
  running its bundled code against the current database.
- Icons/splash come from `assets/` via `npx capacitor-assets generate --android`.
