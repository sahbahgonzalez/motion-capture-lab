# 📹 Camera Troubleshooting Guide

Complete guide to resolving camera access issues for the AR/MR Fitness app.

---

## 🔍 Quick Diagnosis

### Symptom: "Camera blocked" or "Permission denied"

| Environment | Expected Behavior | Solution |
|-------------|-------------------|----------|
| **Figma Make** | ❌ Camera blocked (iframe) | ✅ Automatic Test Mode |
| **Localhost HTTP** | ⚠️ May be blocked | ✅ Allow in browser OR use HTTPS |
| **Localhost HTTPS** | ✅ Should work | Check permissions |
| **Mobile Browser** | ⚠️ Requires HTTPS | Use HTTPS setup |
| **Production** | ✅ Should work | Check permissions |

---

## 🌐 Browser Permissions

### Google Chrome (Recommended)

#### Desktop
1. Click **lock icon** 🔒 in address bar
2. Click **"Site settings"**
3. Find **Camera** → Select **"Allow"**
4. **Refresh page** (Ctrl+R / Cmd+R)

#### If that doesn't work:
1. Go to `chrome://settings/content/camera`
2. Remove site from **"Blocked"** list
3. Add to **"Allowed"** list
4. **Hard refresh**: Ctrl+Shift+R (Win) / Cmd+Shift+R (Mac)

#### Mobile (Android)
1. Long-press URL in address bar
2. Tap **"Site settings"**
3. **Camera** → **"Allow"**
4. Refresh page

### Safari (iOS/Mac)

#### Desktop (Mac)
1. Go to **Safari → Settings → Websites**
2. Click **Camera** in left sidebar
3. Find your site → Select **"Allow"**
4. Refresh page

#### Mobile (iOS)
1. Go to **Settings** (iOS settings, not Safari)
2. Scroll to **Safari**
3. Tap **Camera** → **"Ask"** or **"Allow"**
4. Reload page in Safari
5. Tap **"Allow"** when prompted

### Firefox

1. Click **lock icon** 🔒 in address bar
2. Click **arrow** next to "Blocked" permissions
3. Click **X** next to camera block
4. Refresh page → Click **"Allow"** when prompted

### Edge

1. Click **lock icon** 🔒 in address bar
2. **Permissions** → **Camera** → **"Allow"**
3. Refresh page

---

## 💻 System Permissions

Camera must be allowed at **both** browser AND system level.

### Windows 10/11

#### Check System Settings
1. Press `Win + I` → **Privacy & Security**
2. Click **Camera** (left sidebar)
3. Toggle **"Camera access"** → **ON**
4. Toggle **"Let apps access your camera"** → **ON**
5. Scroll down → Find your browser → Toggle **ON**

#### Check Device Manager
1. Press `Win + X` → **Device Manager**
2. Expand **"Cameras"** or **"Imaging devices"**
3. Right-click camera → **Enable device**
4. If disabled/missing, update drivers

#### Common Issues
- **Disabled**: Right-click → Enable
- **Missing driver**: Right-click → Update driver
- **In use**: Close Zoom, Teams, Skype, etc.

### macOS

#### System Settings (macOS 13+)
1. Apple menu →  **System Settings**
2. Click **Privacy & Security** (left sidebar)
3. Click **Camera**
4. Toggle **ON** for your browser (Chrome, Safari, etc.)

#### System Preferences (macOS 12 and earlier)
1. Apple menu →  **System Preferences**
2. Click **Security & Privacy**
3. Click **Camera** tab
4. Check box next to your browser

#### Terminal Check (Advanced)
```bash
# Check camera status
system_profiler SPCameraDataType

# Reset camera permissions (requires restart)
tccutil reset Camera
```

### Linux

#### Check Video Devices
```bash
# List video devices
ls -l /dev/video*

# Check permissions
v4l2-ctl --list-devices
```

#### Grant Permissions
```bash
# Add user to video group
sudo usermod -a -G video $USER

# Reboot required
sudo reboot
```

---

## 🔐 HTTPS Setup (Mobile Testing)

Mobile browsers **require HTTPS** for camera access.

### Option 1: Vite Basic SSL (Quick)

#### Install SSL Plugin
```bash
npm install -D @vitejs/plugin-basic-ssl
```

#### Update `vite.config.ts`
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    https: true,
    host: true // Expose to network
  }
})
```

#### Restart Dev Server
```bash
npm run dev
```

#### Access on Desktop
```
https://localhost:5173
```
**Accept security warning** (self-signed certificate is safe for development)

#### Access on Mobile
```
https://YOUR_IP:5173
```
Example: `https://192.168.1.100:5173`

**Accept certificate warning** on mobile

---

### Option 2: mkcert (Trusted Certificate)

#### Install mkcert

**Windows (Chocolatey)**:
```bash
choco install mkcert
```

**Mac (Homebrew)**:
```bash
brew install mkcert
mkcert -install
```

**Linux**:
```bash
# Ubuntu/Debian
sudo apt install libnss3-tools
wget https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-linux-amd64
chmod +x mkcert-v1.4.4-linux-amd64
sudo mv mkcert-v1.4.4-linux-amd64 /usr/local/bin/mkcert
mkcert -install
```

#### Generate Certificate
```bash
# In project root
mkcert localhost 192.168.1.100 # Replace with your IP

# Creates:
# - localhost+1.pem (certificate)
# - localhost+1-key.pem (key)
```

#### Update `vite.config.ts`
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'

export default defineConfig({
  plugins: [react()],
  server: {
    https: {
      key: fs.readFileSync('./localhost+1-key.pem'),
      cert: fs.readFileSync('./localhost+1.pem'),
    },
    host: true
  }
})
```

#### Restart Server
```bash
npm run dev
```

**No security warnings!** Trusted certificate works on all devices on your network.

---

## 🔥 Firewall Configuration

### Windows Firewall

#### Allow Port 5173
```powershell
# Run PowerShell as Administrator
New-NetFirewallRule -DisplayName "Vite Dev Server" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow
```

#### Or use GUI:
1. Press `Win + R` → type `wf.msc` → Enter
2. Click **"Inbound Rules"** → **"New Rule"**
3. **Port** → **TCP** → **5173** → **Allow** → **All profiles**

### macOS Firewall

1. System Settings → **Network** → **Firewall**
2. Click **Options**
3. Click **+** → Add browser or Node.js
4. Or disable firewall temporarily for testing

### Linux (UFW)
```bash
sudo ufw allow 5173/tcp
sudo ufw reload
```

---

## 📱 Mobile-Specific Issues

### iOS Safari

**Issue**: Camera permission denied

**Solutions**:
1. **Settings → Safari → Camera** → "Ask" or "Allow"
2. **Settings → Screen Time → Content & Privacy** → Ensure Safari unrestricted
3. Use **Safari only** (not Chrome/Firefox on iOS - they use Safari engine)
4. Try **Private Browsing** mode
5. **Restart phone** after changing settings

**Issue**: "Camera not supported"

**Solution**: HTTPS required
- Use HTTPS setup (see above)
- Or deploy to production HTTPS URL

### Android Chrome

**Issue**: Camera blocked

**Solutions**:
1. Chrome → **Three dots** → **Settings** → **Site settings** → **Camera** → Allow
2. **Android Settings** → **Apps** → **Chrome** → **Permissions** → **Camera** → Allow
3. Clear Chrome data: **Settings** → **Apps** → **Chrome** → **Storage** → **Clear cache**

**Issue**: "getUserMedia not supported"

**Solution**: Update Chrome
- Play Store → Update Chrome
- Requires Chrome 53+ for camera API

### Mobile Network Issues

**Issue**: Can't access `http://192.168.1.100:5173` on mobile

**Checklist**:
- [ ] Same WiFi network (not mobile data)
- [ ] Correct IP address (check with `ipconfig`/`ifconfig`)
- [ ] Dev server running with `--host` flag
- [ ] Firewall allows port 5173
- [ ] Try different port: `npm run dev -- --port 3000`
- [ ] Try computer name instead: `http://COMPUTERNAME.local:5173`

---

## 🐛 Advanced Debugging

### Browser Console

Press **F12** → **Console** tab

#### Check camera availability:
```javascript
navigator.mediaDevices.enumerateDevices()
  .then(devices => {
    const cameras = devices.filter(d => d.kind === 'videoinput');
    console.log('Cameras found:', cameras.length);
    cameras.forEach(cam => console.log(cam.label));
  });
```

#### Test camera access:
```javascript
navigator.mediaDevices.getUserMedia({ video: true })
  .then(stream => {
    console.log('✅ Camera access granted!', stream);
    stream.getTracks().forEach(track => track.stop());
  })
  .catch(err => {
    console.error('❌ Camera error:', err.name, err.message);
  });
```

### Check Permissions API
```javascript
navigator.permissions.query({ name: 'camera' })
  .then(result => {
    console.log('Camera permission:', result.state);
    // "granted", "prompt", or "denied"
  });
```

### Vite Network Configuration

#### Force IPv4
```typescript
// vite.config.ts
export default defineConfig({
  server: {
    host: '0.0.0.0', // Listen on all interfaces
    port: 5173,
    strictPort: true, // Fail if port in use
  }
})
```

#### Custom Host
```bash
npm run dev -- --host 0.0.0.0 --port 3000
```

---

## 🔄 Reset Everything

### Nuclear Option (When all else fails)

#### Browser
1. Clear all site data: `Ctrl+Shift+Delete` / `Cmd+Shift+Delete`
2. Remove site from Settings → Privacy → Site Settings
3. Restart browser
4. Hard refresh: `Ctrl+Shift+R` / `Cmd+Shift+R`

#### Camera
1. **Close ALL apps** using camera (Zoom, Teams, Skype, Discord)
2. **Task Manager** (Ctrl+Shift+Esc) → End camera processes
3. **Restart computer**
4. Test camera in native app (Windows Camera / Photo Booth)

#### Project
```bash
# Stop dev server (Ctrl+C)
# Delete node modules
rm -rf node_modules package-lock.json
# Reinstall
npm install
# Restart
npm run dev
```

---

## ✅ Verification Checklist

Work through this checklist systematically:

### Browser Level
- [ ] Camera permission = "Allow" (not "Ask")
- [ ] Site not in blocked list
- [ ] Hard refresh performed (Ctrl+Shift+R)
- [ ] No browser extensions blocking camera
- [ ] Tried incognito/private mode

### System Level
- [ ] Camera enabled in system settings
- [ ] Browser allowed in camera apps list
- [ ] Camera driver installed and enabled
- [ ] Camera works in other apps (Zoom, native camera)
- [ ] No other app using camera simultaneously

### Network Level (Mobile)
- [ ] Mobile on same WiFi as computer
- [ ] Using correct IP address
- [ ] Firewall allows port 5173
- [ ] HTTPS enabled for mobile testing
- [ ] Certificate accepted on mobile

### Code Level
- [ ] `npm run dev` running successfully
- [ ] No console errors (F12)
- [ ] getUserMedia API supported (check browser)
- [ ] Test Mode works (fallback mode)

---

## 🎯 Expected Results

### ✅ Working Camera
- Permission prompt appears on first visit
- Video feed displays in browser
- Stick figure overlay visible
- Calibration sequence functional
- No console errors

### ✅ Test Mode (Figma Make)
- Automatic activation in iframe
- Purple "Test Mode Active" badge
- Gradient background with grid
- All features functional except live camera

---

## 📞 Still Not Working?

### Gather Information

1. **Environment**:
   - OS: _______________
   - Browser + Version: _______________
   - Device: _______________

2. **Error Messages**:
   - Browser console (F12): _______________
   - Permission state: _______________

3. **What You've Tried**:
   - [ ] Browser permissions
   - [ ] System permissions
   - [ ] Different browser
   - [ ] Incognito mode
   - [ ] HTTPS setup
   - [ ] Firewall configuration
   - [ ] Restart computer

### Debug Output
Run this in browser console and share output:
```javascript
console.log('Navigator:', !!navigator.mediaDevices);
console.log('getUserMedia:', typeof navigator.mediaDevices?.getUserMedia);
navigator.mediaDevices?.enumerateDevices().then(d => 
  console.log('Devices:', d.filter(x => x.kind === 'videoinput'))
);
```

---

**🎉 Once camera works, you're ready to test the full AR fitness experience!**
