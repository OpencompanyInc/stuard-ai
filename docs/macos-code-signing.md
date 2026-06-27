# macOS Code Signing & Notarization Guide

This document explains how to set up code signing and notarization for the Stuard AI desktop app on macOS.

## Why is this needed?

macOS Gatekeeper blocks unsigned apps downloaded from the internet with the error:
> "Stuard AI.app" is damaged and can't be opened. You should move it to the Trash.

To fix this, the app must be:
1. **Code signed** with a Developer ID certificate
2. **Notarized** by Apple

## Prerequisites

- Apple Developer Program membership ($99/year): https://developer.apple.com/programs/
- A Mac with Xcode installed (for certificate management)

## Step 1: Create Developer ID Certificate

1. Go to https://developer.apple.com/account/resources/certificates/list
2. Click the "+" button to create a new certificate
3. Select "Developer ID Application" (for distributing outside App Store)
4. Follow the instructions to create a CSR using Keychain Access
5. Download and install the certificate

## Step 2: Export Certificate as .p12

1. Open Keychain Access
2. Find your "Developer ID Application" certificate
3. Right-click > Export
4. Save as .p12 file with a strong password
5. Base64 encode the certificate:
   ```bash
   base64 -i certificate.p12 -o certificate-base64.txt
   ```

## Step 3: Create App-Specific Password

1. Go to https://appleid.apple.com/account/manage
2. Sign in with your Apple ID
3. Go to Security > App-Specific Passwords
4. Click "Generate Password"
5. Name it "Stuard AI CI/CD" and save the password

## Step 4: Find Your Team ID

1. Go to https://developer.apple.com/account
2. Click on "Membership" in the sidebar
3. Your Team ID is a 10-character alphanumeric string (e.g., "ABC123DEF4")

## Step 5: Add GitHub Secrets

Add these secrets to your GitHub repository (Settings > Secrets > Actions):

| Secret Name | Value |
|-------------|-------|
| `MAC_CERTIFICATE_BASE64` | Content of certificate-base64.txt (from Step 2) |
| `MAC_CERTIFICATE_PASSWORD` | Password used when exporting the .p12 file |
| `APPLE_ID` | Your Apple ID email address |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password (from Step 3) |
| `APPLE_TEAM_ID` | Your 10-character Team ID (from Step 4) |

## Step 6: Enable Code Signing in Workflows

In the release workflow files, uncomment these lines in the "Build Desktop App" step:

```yaml
env:
  CSC_LINK: ${{ secrets.MAC_CERTIFICATE_BASE64 }}
  CSC_KEY_PASSWORD: ${{ secrets.MAC_CERTIFICATE_PASSWORD }}
  APPLE_ID: ${{ secrets.APPLE_ID }}
  APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
  APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

## Step 7: Add Entitlements (Optional but Recommended)

Create `apps/desktop/build/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

Then update `apps/desktop/package.json` build config:

```json
"mac": {
  "entitlements": "build/entitlements.mac.plist",
  "entitlementsInherit": "build/entitlements.mac.plist",
  "notarize": {
    "teamId": "YOUR_TEAM_ID"
  }
}
```

## Troubleshooting

### "The signature of the binary is invalid"
- Ensure all native binaries (like the Python agent) are also signed
- Check that `hardenedRuntime: true` is set in electron-builder config

### Notarization fails with "package is invalid"
- Check Apple's notarization logs for specific errors
- Ensure entitlements file is correctly formatted
- Verify the app bundle structure is correct

### "Unable to build chain to self-signed root"
- Install the Apple Worldwide Developer Relations Certificate
- Download from: https://www.apple.com/certificateauthority/

## Temporary Workaround for Users

Until code signing is enabled, users can bypass Gatekeeper (not recommended for general users):

```bash
# Remove quarantine attribute
xattr -cr "/Applications/Stuard AI.app"
```

Or in System Settings > Privacy & Security, click "Open Anyway" after the first launch attempt.

## References

- [electron-builder Code Signing](https://www.electron.build/code-signing)
- [electron-builder Notarization](https://www.electron.build/configuration/mac#NotarizeNotaryOptions)
- [Apple Developer Documentation](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
