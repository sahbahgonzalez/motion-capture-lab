# 📱 Mobile Device Testing Guide

Complete guide for testing the AR fitness app on iOS and Android devices.

---

## 🎯 Overview

Testing on mobile is crucial because:
- ✅ Users will primarily use phones for fitness
- ✅ Mobile cameras provide better portability
- ✅ Validates real-world use cases
- ✅ Tests touch interactions and responsive design

---

## ⚙️ Prerequisites

### On Your Computer:
- [ ] Development server running (`npm run dev`)
- [ ] Computer connected to WiFi (not ethernet only)
- [ ] Firewall allows port 5173 (or your custom port)
- [ ] HTTPS enabled (recommended for mobile - see setup below)

### On Your Mobile Device:
- [ ] Connected to **same WiFi network** as computer
- [ ] Modern browser installed (Chrome for Android, Safari for iOS)
- [ ] Camera permission available (Settings → Privacy → Camera)

---

## 🚀 Quick Setup (HTTP - For Testing Only)

### Step 1: Get Your Computer's IP Address

#### Windows:
```bash
ipconfig
```
Look for `IPv4 Address` under your WiFi adapter:
```
Wireless LAN adapter Wi-Fi:
   IPv4 Address. . . . . . . . . : 192.168.1.100
                                   ^^^^^^^^^^^^^^
```

#### Mac:
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```
Or: System Settings → Network → Wi-Fi → Details → IP address

#### Linux:
```bash
hostname -I
```
Or:
```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
```

**Example IP**: `192.168.1.100` (yours will be different)

### Step 2: Ensure Server Exposes to Network

If you see this in terminal:
```
➜  Local:   http://localhost:5173/
➜  Network: http://192.168.1.100:5173/  ← Perfect!
```

If you DON'T see the "Network" line, restart with:
```bash
npm run dev -- --host
```

### Step 3: Open on Mobile

1. Open **Chrome** (Android) or **Safari** (iOS)
2. Type in address bar:
   ```
   http://192.168.1.100:5173
   ```
   (Replace with YOUR IP address)
3. Press Go/Enter

**Result**:
- ✅ App loads → Continue to Step 4
- ❌ "Can't connect" → See troubleshooting below
- ⚠️ Camera blocked → Set up HTTPS (next section)

### Step 4: Allow Camera Access

1. Browser will prompt: **"Allow [site] to access camera?"**
2. Tap **"Allow"**
3. Camera feed should appear

**Not seeing prompt?** Check [CAMERA_TROUBLESHOOTING.md](./CAMERA_TROUBLESHOOTING.md)

---

## 🔐 HTTPS Setup (Recommended for Mobile)

Mobile browsers often **require HTTPS** for camera access.

### Method 1: Vite Basic SSL (Quick & Easy)

#### 1. Install SSL Plugin
```bash
npm install -D @vitejs/plugin-basic-ssl
```

#### 2. Create/Update `vite.config.ts`

If file doesn't exist, create it in project root:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    https: true,
    host: true, // Expose to network
    port: 5173
  }
})
```

If file exists, just add the `basicSsl()` plugin and https config.

#### 3. Restart Dev Server
```bash
# Stop server (Ctrl+C)
npm run dev
```

You should see:
```
➜  Local:   https://localhost:5173/   ← Note HTTPS!
➜  Network: https://192.168.1.100:5173/
```

#### 4. Accept Certificate Warning

**On Desktop (first time):**
1. Go to `https://localhost:5173`
2. You'll see "Your connection is not private"
3. Click **"Advanced"** → **"Proceed to localhost (unsafe)"**
   - This is safe - it's your own self-signed certificate

**On Mobile:**
1. Go to `https://192.168.1.100:5173` (your IP)
2. You'll see certificate warning
3. Tap **"Advanced"** or **"Details"**
4. Tap **"Proceed"** or **"Visit this website"**
5. Accept the risk (it's your local development server)

**Now camera should work!** 🎉

---

### Method 2: mkcert (Trusted Certificate - No Warnings)

This creates a locally-trusted SSL certificate - **no security warnings!**

#### 1. Install mkcert

**Windows (using Chocolatey):**
```bash
choco install mkcert
```
Don't have Chocolatey? Install from: https://chocolatey.org/install

**Mac (using Homebrew):**
```bash
brew install mkcert
mkcert -install
```

**Linux:**
```bash
# Install dependencies
sudo apt install libnss3-tools

# Download mkcert
wget https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-linux-amd64
chmod +x mkcert-v1.4.4-linux-amd64
sudo mv mkcert-v1.4.4-linux-amd64 /usr/local/bin/mkcert

# Install root certificate
mkcert -install
```

#### 2. Generate Certificate for Your IP

```bash
# In your project root
# Replace 192.168.1.100 with YOUR actual IP
mkcert localhost 192.168.1.100 127.0.0.1 ::1
```

This creates:
- `localhost+3.pem` (certificate)
- `localhost+3-key.pem` (private key)

#### 3. Update `vite.config.ts`

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    https: {
      key: fs.readFileSync(path.resolve(__dirname, './localhost+3-key.pem')),
      cert: fs.readFileSync(path.resolve(__dirname, './localhost+3.pem'))
    },
    host: true,
    port: 5173
  }
})
```

#### 4. Install Root CA on Mobile Device

This step makes the certificate trusted on your phone.

**iOS:**
1. On computer, find: `"$(mkcert -CAROOT)/rootCA.pem"`
2. Email it to yourself or upload to cloud (iCloud, Dropbox)
3. On iPhone, open the file
4. Settings → Profile Downloaded → Install
5. Settings → General → About → Certificate Trust Settings
6. Enable full trust for mkcert root CA

**Android:**
1. On computer, find: `"$(mkcert -CAROOT)/rootCA.pem"`
2. Copy to phone via USB or cloud
3. Settings → Security → Install from storage
4. Select the rootCA.pem file
5. Name it "mkcert" and select "VPN and apps"

#### 5. Restart Server and Test
```bash
npm run dev
```

Open `https://192.168.1.100:5173` on mobile - **no certificate warning!** ✅

---

## 🧪 Testing Checklist

### Initial Connection
- [ ] App loads on mobile browser
- [ ] No console errors (check mobile browser DevTools)
- [ ] Responsive layout looks correct
- [ ] Touch interactions work

### Camera Access
- [ ] Permission prompt appears
- [ ] Camera activates (front-facing)
- [ ] Video feed displays full-screen
- [ ] No lag or freezing

### Calibration System
- [ ] "Start Calibration" button taps correctly
- [ ] All 8 calibration poses display
- [ ] Stick figure overlay visible on camera
- [ ] Position validation (red → green) works
- [ ] 1-second confirmation pause triggers
- [ ] Can complete full calibration sequence

### Exercise Selection
- [ ] Exercise cards tap correctly
- [ ] Scroll works smoothly
- [ ] Images load properly
- [ ] Selection transitions correctly

### Pre-Exercise Walkthrough
- [ ] Demonstration video/images display
- [ ] Instructions readable
- [ ] "Start Exercise" button works

### Live Exercise View
- [ ] Camera + stick figure overlay loads
- [ ] Real-time feedback visible
- [ ] Joint highlighting works
- [ ] Audio feedback plays through phone speaker
- [ ] Position corrections detected
- [ ] Rep counter increments

### Audio Feedback
- [ ] Audio plays without user interaction
- [ ] Volume appropriate
- [ ] No audio cutting out
- [ ] Feedback timing correct

### Post-Exercise Analysis
- [ ] Results screen displays
- [ ] Data accurate (reps, corrections, time)
- [ ] Charts/graphs render
- [ ] "Back to Exercises" works

### Performance
- [ ] No significant lag
- [ ] Smooth animations
- [ ] Responsive touch
- [ ] Camera runs at good framerate

---

## 🎯 iOS-Specific Testing

### Safari (Recommended for iOS)

**Why Safari?**
- Best camera API support on iOS
- Chrome/Firefox on iOS use Safari engine anyway
- Native permissions integration

#### Camera Permissions
1. **iOS Settings** → **Safari** → **Camera** → "Allow"
2. Or in Safari: Long-press URL → **Site Settings** → **Camera** → "Allow"

#### Common Issues

**Issue**: "Camera not supported"  
**Solution**: Must use HTTPS (see setup above)

**Issue**: Camera permission denied  
**Solution**: 
- Settings → Screen Time → Content & Privacy → disable restrictions
- Settings → Safari → Clear History and Website Data
- Try private browsing mode

**Issue**: Audio doesn't play  
**Solution**:
- iOS requires user interaction for audio
- Our app handles this - ensure you tapped "Start Exercise"

### Test Devices
- iPhone 12+ (iOS 15+) - Full support
- iPhone X-11 (iOS 14+) - Works well
- iPhone 8 or older - May have performance issues

### Screen Sizes
- Test both iPhone (smaller) and iPad (larger)
- Verify portrait orientation
- Check landscape (should be discouraged)

---

## 🤖 Android-Specific Testing

### Chrome (Recommended for Android)

**Why Chrome?**
- Full MediaDevices API support
- Best WebRTC implementation
- Remote debugging available

#### Camera Permissions
1. **Chrome** → Three dots → **Settings** → **Site settings** → **Camera** → Allow
2. **Android Settings** → **Apps** → **Chrome** → **Permissions** → **Camera** → Allow

#### Common Issues

**Issue**: "getUserMedia is not defined"  
**Solution**: Update Chrome to latest version (requires Android 5.0+)

**Issue**: Camera shows upside down  
**Solution**: Known bug in some Android versions - app should handle orientation

**Issue**: Performance lag  
**Solution**:
- Close other apps
- Enable "Lite mode" in Chrome
- Reduce camera resolution (app settings)

### Remote Debugging (Advanced)

Debug your app on Android from your computer:

1. **Enable Developer Options** on Android:
   - Settings → About phone → Tap "Build number" 7 times

2. **Enable USB Debugging**:
   - Settings → System → Developer options → USB debugging

3. **Connect Phone to Computer** via USB

4. **On Computer**: Open Chrome → `chrome://inspect`

5. **Select Your Device** → Inspect your app

Now you can use desktop DevTools to debug mobile!

### Test Devices
- Google Pixel/Samsung S-series (latest) - Full support
- OnePlus, Xiaomi - Generally work well
- Older Android (<5.0) - Limited support

---

## 📊 Performance Testing

### Metrics to Check

**Camera Framerate**:
- Should be 30fps minimum
- Check in DevTools → Performance

**Touch Response**:
- Tap-to-response < 100ms
- No delayed interactions

**Memory Usage**:
- Should stay under 200MB
- Watch for memory leaks (leave open 5+ mins)

**Battery Drain**:
- Normal during active use (camera is intensive)
- Should not drain when app is backgrounded

### Testing Tools

**Chrome DevTools (Remote)**:
```
chrome://inspect
```

**Safari Web Inspector** (Mac + iOS):
1. Mac: Safari → Preferences → Advanced → Show Develop menu
2. iPhone: Settings → Safari → Advanced → Web Inspector
3. Mac: Develop → [Your iPhone] → [Your App]

---

## 🌐 Network Troubleshooting

### Can't Connect to Server

**Symptom**: "This site can't be reached" or timeout

**Checklist**:
- [ ] Computer and phone on **same WiFi network** (not mobile data)
- [ ] WiFi **not isolated** (some guest networks block device-to-device)
- [ ] Correct IP address (double-check with `ipconfig`/`ifconfig`)
- [ ] Dev server running (check terminal)
- [ ] Using correct port (5173 by default)
- [ ] Firewall allows connections (see below)

**Test Connection**:
```bash
# On your phone, try pinging your computer
# Android: Download "Ping Tools" app
# iOS: Download "Network Ping Lite" app
# Ping: 192.168.1.100 (your computer IP)
```

### Firewall Configuration

**Windows**:
```powershell
# Run PowerShell as Administrator
New-NetFirewallRule -DisplayName "Vite Dev" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow
```

**Mac**:
- System Settings → Network → Firewall → Off (temporarily)
- Or add Node.js/Terminal to allowed apps

**Linux**:
```bash
sudo ufw allow 5173/tcp
```

### Alternative: Use Different Port

If 5173 is blocked:
```bash
npm run dev -- --port 8080 --host
```
Then access: `http://YOUR_IP:8080`

---

## 🎥 Camera Troubleshooting

### Camera Not Starting

**Check permissions**:
```javascript
// Open browser console on mobile (DevTools)
navigator.permissions.query({name: 'camera'})
  .then(result => console.log(result.state))
  // Should be "granted"
```

**Manual permission reset**:
- iOS: Settings → Safari → Advanced → Website Data → Remove All
- Android: Chrome → Settings → Site settings → Camera → Clear & reset

### Camera Shows Black Screen

**Possible causes**:
1. Another app using camera (close WhatsApp, Instagram, etc.)
2. Hardware issue (test with native camera app)
3. Browser bug (restart browser)

### Wrong Camera (Back instead of Front)

**App should request front camera**, but if wrong:
- Check component: `CameraFeed.tsx` → `facingMode: 'user'`
- Some devices require explicit selection

---

## 💡 Best Practices

### For Optimal Testing

**Environment**:
- 📍 **Space**: 6-8 feet in front of camera
- 💡 **Lighting**: Bright, face light source
- 🖼️ **Background**: Uncluttered, contrast with body
- 📱 **Position**: Vertical (portrait), stable

**Device**:
- 🔋 **Battery**: 50%+ (camera is intensive)
- 📶 **WiFi**: Strong signal (stay near router)
- 🔇 **Notifications**: Silent mode (avoid interruptions)
- 🌡️ **Temperature**: Cool device (camera generates heat)

**Testing Flow**:
1. Start with simple test (just load page)
2. Test camera access
3. Test calibration
4. Test one exercise fully
5. Test all exercises
6. Test edge cases (rotate phone, switch apps, etc.)

---

## 📋 Test Scenarios

### Scenario 1: First-Time User
1. Open app (never visited before)
2. Accept camera permission
3. Complete calibration
4. Do one exercise
5. View results

**Expected**: Smooth onboarding, clear instructions

### Scenario 2: Returning User
1. Open app (visited before)
2. Camera loads immediately (permission remembered)
3. Skip calibration (already calibrated)
4. Select different exercise

**Expected**: Fast startup, no re-permission

### Scenario 3: Permission Denied
1. Open app
2. Deny camera permission
3. See error message
4. Grant permission later
5. Retry

**Expected**: Graceful error, clear recovery path

### Scenario 4: Poor Network
1. Move far from router (weak WiFi)
2. Open app
3. Test functionality

**Expected**: App loads (cached), camera works (local)

### Scenario 5: Interrupted Session
1. Start exercise
2. Switch to another app (Messages)
3. Return to fitness app

**Expected**: Resume or restart gracefully

---

## 🐛 Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Black screen | Camera not initialized | Check permissions, reload |
| Upside down video | Device orientation | Lock portrait mode |
| Audio doesn't play | iOS restrictions | Ensure user tapped to start |
| Slow performance | Low-end device | Close other apps, reduce quality |
| Disconnected | Network interrupted | Check WiFi, refresh page |
| Certificate error | HTTPS self-signed | Accept warning or use mkcert |
| Touch not working | Z-index overlay | Check CSS positioning |
| Calibration stuck | Position not detected | Adjust distance/lighting |

---

## ✅ Final Verification

Before considering mobile testing complete:

**Core Functionality**:
- [x] App loads on mobile
- [x] Camera access works
- [x] Calibration completes successfully
- [x] All 4 exercises selectable
- [x] Exercise execution works
- [x] Audio feedback plays
- [x] Results screen displays

**User Experience**:
- [x] Touch targets large enough (44x44px minimum)
- [x] Text readable without zooming
- [x] Buttons responsive to tap
- [x] No horizontal scrolling
- [x] Portrait orientation enforced
- [x] Loading states shown

**Performance**:
- [x] Camera runs smoothly (30fps+)
- [x] No memory leaks (stable after 10 mins)
- [x] Reasonable battery usage
- [x] No overheating

**Edge Cases**:
- [x] Works with phone call interruption
- [x] Handles app switching
- [x] Survives screen lock/unlock
- [x] Works in low light (degrades gracefully)
- [x] Handles permission denial gracefully

---

## 🎉 Success!

If you've completed this checklist, your AR fitness app is **fully tested and ready for mobile use!**

### Next Steps:
1. ✅ Deploy to production (Vercel, Netlify)
2. ✅ Share with real users
3. ✅ Gather feedback
4. ✅ Iterate and improve

**Production deployment will give you a real HTTPS URL** - no more certificate warnings or network IP setup!

---

**Need help?** Check:
- [CAMERA_TROUBLESHOOTING.md](./CAMERA_TROUBLESHOOTING.md)
- [LOCAL_SETUP_GUIDE.md](./LOCAL_SETUP_GUIDE.md)
