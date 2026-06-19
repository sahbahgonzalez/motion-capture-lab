# 🏃‍♂️ AR/MR Fitness Form Correction - Local Setup Guide

This guide will help you run the AR/MR Fitness app on localhost and test it on mobile devices.

---

## 📋 Prerequisites

Before you begin, make sure you have:

- **Node.js** (v18 or higher) - [Download here](https://nodejs.org/)
- **VS Code** - [Download here](https://code.visualstudio.com/)
- **Git** (optional but recommended)

---

## 🚀 Step 1: Export Code from Figma Make

### Option A: Download ZIP
1. In Figma Make, click the **menu** (three dots) in the top right
2. Select **"Export Project"** or **"Download Code"**
3. Save the ZIP file to your computer
4. Extract the ZIP to a folder (e.g., `ar-fitness-app`)

### Option B: Copy Files Manually
1. Create a new folder on your computer (e.g., `ar-fitness-app`)
2. Copy all files from Figma Make to this folder
3. Maintain the same folder structure

---

## 🛠️ Step 2: Set Up in VS Code

### 1. Open the Project
```bash
# Open VS Code
# File → Open Folder → Select your project folder
```

### 2. Open Terminal in VS Code
- **Windows/Linux**: `Ctrl + ` (backtick)
- **Mac**: `Cmd + ` (backtick)
- Or: `Terminal → New Terminal` from menu

### 3. Verify Node.js Installation
```bash
node --version
npm --version
```
You should see version numbers (e.g., `v20.x.x` and `10.x.x`)

---

## 📦 Step 3: Install Dependencies

In the VS Code terminal, run:

```bash
npm install
```

This will install all required packages (React, TypeScript, Tailwind, Vite, etc.)

**Expected output:**
```
added 500+ packages in 30s
```

---

## 🏃 Step 4: Run Development Server

### Start the Dev Server
```bash
npm run dev
```

**Expected output:**
```
  VITE v5.x.x  ready in 500 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.x:5173/
  ➜  press h + enter to show help
```

### Access in Browser
1. Open your browser (Chrome recommended)
2. Go to: `http://localhost:5173`
3. **Allow camera access** when prompted
4. You should see the AR Fitness app! 🎉

---

## 📱 Step 5: Test on Mobile Device

### Prerequisites
- Your mobile device must be on the **same WiFi network** as your computer
- Your computer's firewall must allow local network connections

### Find Your Network IP Address

#### **Windows:**
```bash
ipconfig
```
Look for `IPv4 Address` under your WiFi adapter (e.g., `192.168.1.100`)

#### **Mac/Linux:**
```bash
ifconfig | grep "inet "
```
Or:
```bash
ip addr show
```
Look for an address like `192.168.1.100` or `10.0.0.x`

### Access on Mobile

1. **On your computer**: Make sure `npm run dev` is running
2. **Note the Network URL** from the terminal output (e.g., `http://192.168.1.100:5173`)
3. **On your mobile device**:
   - Open **Chrome** or **Safari**
   - Type the Network URL in the address bar
   - Example: `http://192.168.1.100:5173`
4. **Allow camera access** when prompted
5. Test the app! 📱

---

## 🔧 Troubleshooting

### Camera Not Working on Localhost

**Issue**: Camera blocked even on localhost

**Solutions**:
1. **Use HTTPS**: Browsers require HTTPS for camera in some cases
   ```bash
   npm install -D @vitejs/plugin-basic-ssl
   ```
   Then create/update `vite.config.ts`:
   ```typescript
   import { defineConfig } from 'vite'
   import react from '@vitejs/plugin-react'
   import basicSsl from '@vitejs/plugin-basic-ssl'

   export default defineConfig({
     plugins: [react(), basicSsl()],
     server: {
       https: true,
       host: true
     }
   })
   ```
   Access via: `https://localhost:5173` (accept security warning)

2. **Browser Permissions**: 
   - Chrome: Click lock icon 🔒 → Site settings → Camera → Allow
   - Clear site data and refresh

3. **System Permissions**:
   - Windows: Settings → Privacy → Camera → Allow apps
   - Mac: System Settings → Privacy & Security → Camera → Allow browser

### Mobile Device Can't Connect

**Issue**: Mobile shows "Cannot connect" or times out

**Solutions**:
1. **Check same WiFi**: Both devices must be on same network
2. **Firewall**: Allow port 5173 through firewall
   ```bash
   # Windows (run as admin)
   netsh advfirewall firewall add rule name="Vite Dev Server" dir=in action=allow protocol=TCP localport=5173
   
   # Mac
   # System Settings → Network → Firewall → Allow port 5173
   ```
3. **Use different port**: If 5173 is blocked, try:
   ```bash
   npm run dev -- --port 3000
   ```
4. **Try IP directly**: Use `192.168.x.x:5173` instead of computer name

### Mobile Camera Not Working

**Issue**: Camera blocked on mobile browser

**Solutions**:
1. **Use HTTPS** (see above) - Mobile browsers are strict about camera
2. **Use Chrome on Android** - Best support for camera API
3. **Use Safari on iOS** - Native browser has best support
4. **Check mobile permissions**: Settings → Apps → Browser → Permissions → Camera

### Port Already in Use

**Issue**: `Error: Port 5173 is already in use`

**Solution**:
```bash
# Kill the process using port 5173
# Windows
netstat -ano | findstr :5173
taskkill /PID <PID> /F

# Mac/Linux
lsof -ti:5173 | xargs kill -9

# Or use different port
npm run dev -- --port 3000
```

### Dependencies Not Installing

**Issue**: `npm install` fails

**Solutions**:
1. Clear npm cache:
   ```bash
   npm cache clean --force
   npm install
   ```
2. Delete `node_modules` and reinstall:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```
3. Update Node.js to latest LTS version

---

## 📂 Project Structure

```
ar-fitness-app/
├── src/
│   └── App.tsx                 # Main app component
├── components/
│   ├── CameraFeed.tsx          # Camera access & test mode
│   ├── ExerciseOverlay.tsx     # AR stick figure overlay
│   ├── CalibrationSystem.tsx   # Calibration flow
│   └── ui/                     # ShadCN components
├── public/                     # Static assets
├── package.json                # Dependencies
├── vite.config.ts             # Vite configuration
└── tsconfig.json              # TypeScript config
```

---

## 🎯 Testing Checklist

### Desktop Testing
- [ ] Camera access works
- [ ] Calibration sequence completes
- [ ] Stick figure overlays correctly
- [ ] Exercise selection works
- [ ] Real-time feedback triggers
- [ ] Audio feedback plays

### Mobile Testing
- [ ] App loads on mobile browser
- [ ] Camera access granted
- [ ] Front camera activates
- [ ] Touch interactions work
- [ ] Calibration completes
- [ ] Exercises work in portrait mode
- [ ] Audio feedback works

---

## 🚀 Building for Production

When ready to deploy:

```bash
# Build optimized production bundle
npm run build

# Preview production build locally
npm run preview
```

Deploy the `dist` folder to:
- **Vercel**: `vercel deploy`
- **Netlify**: Drag & drop `dist` folder
- **GitHub Pages**: Push to `gh-pages` branch

---

## 💡 Tips for Best Mobile Experience

1. **Hold phone vertically** (portrait mode)
2. **Position 4-6 feet** from camera
3. **Good lighting** - Face a window or light source
4. **Stable surface** - Use phone stand or prop
5. **Clear background** - Helps with pose detection visualization
6. **Chrome on Android** - Best performance
7. **Safari on iOS** - Native support

---

## 🆘 Need Help?

Common issues:
- **Camera blocked**: Check browser/system permissions
- **Can't access on mobile**: Verify same WiFi network
- **Slow performance**: Close other apps, use Chrome
- **Calibration stuck**: Refresh page and try again

---

## 📝 Next Steps

Once running successfully:
1. ✅ Test all exercises (push-ups, squats, planks, sit-ups)
2. ✅ Verify audio feedback triggers
3. ✅ Test on multiple devices
4. ✅ Check responsiveness
5. ✅ Deploy to production

---

**🎉 You're ready to go! Start the dev server with `npm run dev` and test your AR fitness app!**
