# 📦 Export from Figma Make & Run Locally

**Complete guide to get your AR fitness app running on your computer and mobile devices.**

---

## 📚 Documentation Overview

This project includes several guides:

| Guide | Purpose | Read This If... |
|-------|---------|-----------------|
| **[QUICK_START.md](./QUICK_START.md)** | 5-minute setup | You want to run locally ASAP |
| **[LOCAL_SETUP_GUIDE.md](./LOCAL_SETUP_GUIDE.md)** | Complete local setup | You want detailed instructions |
| **[MOBILE_TESTING_GUIDE.md](./MOBILE_TESTING_GUIDE.md)** | Mobile device testing | You want to test on phone |
| **[CAMERA_TROUBLESHOOTING.md](./CAMERA_TROUBLESHOOTING.md)** | Camera issues | Camera not working |
| **[README.md](./README.md)** | Project overview | You want to understand the app |

**Start with [QUICK_START.md](./QUICK_START.md) → 5 minutes to running!**

---

## 🎯 What You'll Achieve

### On Localhost (Desktop)
✅ **Full camera access** - Real webcam feed  
✅ **No Test Mode** - Actual camera overlay  
✅ **Fast development** - Live reloading  
✅ **Debugging tools** - Browser DevTools

### On Mobile Device
✅ **Real-world testing** - Phone camera  
✅ **Touch interactions** - Native mobile UX  
✅ **Portrait mode** - Optimal fitness tracking  
✅ **Production-like** - How users will experience it

---

## ⚡ Super Quick Start (3 Steps)

### 1. Export & Extract
- Figma Make → Menu → Export Project
- Extract ZIP to folder

### 2. Install & Run
```bash
cd your-project-folder
npm install
npm run dev
```

### 3. Open Browser
```
http://localhost:5173
```
Allow camera → Done! 🎉

**For mobile**: See [QUICK_START.md](./QUICK_START.md) → "BONUS: Test on Mobile"

---

## 📁 What's in the Export

```
ar-fitness-app/
├── 📄 README.md                      ← Project overview
├── 📄 QUICK_START.md                 ← 5-minute setup (START HERE!)
├── 📄 LOCAL_SETUP_GUIDE.md           ← Complete local instructions
├── 📄 MOBILE_TESTING_GUIDE.md        ← Mobile device testing
├── 📄 CAMERA_TROUBLESHOOTING.md      ← Camera issues solved
├── 📄 EXPORT_AND_RUN.md              ← This file
│
├── 📄 App.tsx                        ← Main application
├── 📁 components/                    ← React components
│   ├── HomePage.tsx
│   ├── CalibrationView.tsx
│   ├── ExerciseSelection.tsx
│   ├── LiveExerciseView.tsx
│   ├── CameraFeed.tsx
│   ├── StickFigure.tsx
│   └── ui/                           ← ShadCN components
│
├── 📁 styles/
│   └── globals.css                   ← Tailwind styles
│
├── 📄 package.json                   ← Dependencies (created on export)
├── 📄 vite.config.ts                 ← Vite config (may need creation)
├── 📄 tsconfig.json                  ← TypeScript config
└── 📁 node_modules/                  ← Created after npm install
```

---

## 🚀 Step-by-Step Export Process

### From Figma Make

1. **Save Your Work** (if not auto-saved)
   - Figma Make auto-saves, but verify recent changes are present

2. **Open Export Menu**
   - Click **three-dot menu** (⋮) in top-right corner
   - Or look for **"Export"** or **"Download"** button

3. **Select Export Option**
   - Choose **"Download Project"** or **"Export Code"**
   - Select format: **ZIP file** (recommended)

4. **Wait for Download**
   - File will be named something like: `ar-fitness-app.zip`
   - Size should be ~50-100KB (without node_modules)

5. **Save to Known Location**
   - Desktop, Documents, or Projects folder
   - Remember the location!

### Extract the Archive

**Windows**:
- Right-click ZIP → **Extract All...**
- Choose destination → **Extract**

**Mac**:
- Double-click ZIP (auto-extracts)
- Or right-click → **Open With** → **Archive Utility**

**Linux**:
```bash
unzip ar-fitness-app.zip -d ar-fitness-app
```

---

## 💻 Local Development Setup

### Prerequisites Check

Run these commands to verify:

```bash
# Check Node.js (need v18+)
node --version
# Should show: v18.x.x or higher

# Check npm (need v9+)
npm --version
# Should show: 9.x.x or higher
```

❌ **Don't have Node.js?**
- Download: https://nodejs.org/
- Get the **LTS** (Long Term Support) version
- Installer includes npm automatically

### Initial Setup

```bash
# Navigate to project
cd path/to/ar-fitness-app

# Install dependencies
npm install

# Start development server
npm run dev
```

**Output should show**:
```
  VITE v5.x.x  ready in 500 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.100:5173/
```

### Open in Browser

1. **Chrome** (recommended) or **Firefox** or **Edge**
2. Navigate to: `http://localhost:5173`
3. **Allow camera** when prompted
4. Start using the app!

---

## 📱 Mobile Testing Setup

### Quick Method (HTTP)

**Requirements**:
- Computer & phone on same WiFi
- Development server running

**Steps**:
1. Note the **Network URL** from terminal: `http://192.168.1.100:5173`
2. On phone browser, visit that URL
3. Accept security warnings if any
4. Allow camera access

**Issues?** → See [MOBILE_TESTING_GUIDE.md](./MOBILE_TESTING_GUIDE.md)

### Recommended Method (HTTPS)

Mobile browsers require HTTPS for camera. Quick setup:

```bash
# Install SSL plugin
npm install -D @vitejs/plugin-basic-ssl

# Create vite.config.ts (if doesn't exist)
```

Add to `vite.config.ts`:
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

```bash
# Restart server
npm run dev

# Now shows HTTPS:
# ➜  Local:   https://localhost:5173/
# ➜  Network: https://192.168.1.100:5173/
```

On mobile, accept certificate warning → Camera works! ✅

**Full HTTPS guide**: [MOBILE_TESTING_GUIDE.md](./MOBILE_TESTING_GUIDE.md) → "HTTPS Setup"

---

## 🎮 Using the App

### First Time Flow

1. **Home Screen** → Click "Start Calibration"
2. **Calibration** → Complete 8 poses (wait for green)
3. **Exercise Library** → Select exercise
4. **Walkthrough** → Review instructions
5. **Exercise Session** → Follow AR overlay
6. **Results** → View performance summary

### Features to Test

**Calibration**:
- All 8 poses (arms up, squat, lunge, etc.)
- Red → Green transition
- 1-second confirmation pause
- Completion screen

**Exercises**:
- Push-ups (arm angle tracking)
- Squats (knee/hip angles)
- Planks (body alignment)
- Sit-ups (core movement)

**Feedback**:
- Visual: Stick figure overlay
- Joint highlighting (red/green)
- Audio corrections (after 3 errors)
- Real-time positioning

---

## 🐛 Common Issues

### "npm: command not found"

**Problem**: Node.js not installed

**Solution**:
```bash
# Download and install from:
https://nodejs.org/

# Then restart terminal and retry
```

### "Cannot find module 'react'"

**Problem**: Dependencies not installed

**Solution**:
```bash
npm install
```

### "Port 5173 already in use"

**Problem**: Another process using port

**Solution**:
```bash
# Use different port
npm run dev -- --port 3000
```

### Camera Shows "Permission Denied"

**Problem**: Browser blocking camera

**Solution**:
1. Click lock icon 🔒 in address bar
2. Camera → Allow
3. Refresh page

**Still not working?** → [CAMERA_TROUBLESHOOTING.md](./CAMERA_TROUBLESHOOTING.md)

### Mobile Can't Connect

**Problem**: Network/firewall issue

**Solution Checklist**:
- [ ] Same WiFi network
- [ ] Correct IP address
- [ ] Server running with `--host` flag
- [ ] Firewall allows port 5173

**Full guide**: [MOBILE_TESTING_GUIDE.md](./MOBILE_TESTING_GUIDE.md) → "Network Troubleshooting"

---

## 🔧 Configuration Files

### May Need to Create

If export doesn't include these, create them:

**vite.config.ts** (for HTTPS):
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Expose to network
    port: 5173
  }
})
```

**tsconfig.json** (TypeScript config):
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src", "components", "App.tsx"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

---

## 📊 Testing Checklist

### Desktop Testing
- [ ] `npm install` completes without errors
- [ ] `npm run dev` starts server successfully
- [ ] Browser opens to localhost:5173
- [ ] Camera permission prompt appears
- [ ] Camera feed displays
- [ ] Calibration system works
- [ ] All 4 exercises accessible
- [ ] Audio feedback plays
- [ ] Post-exercise results display

### Mobile Testing
- [ ] HTTPS setup complete (recommended)
- [ ] Mobile accesses server URL
- [ ] Camera permission granted
- [ ] Camera feed shows (front camera)
- [ ] Touch interactions responsive
- [ ] Calibration completes on mobile
- [ ] Exercises work in portrait mode
- [ ] Audio plays on mobile speaker

---

## 🚀 Next Steps After Local Testing

### 1. Deploy to Production

**Why?**
- Real HTTPS (no certificate warnings)
- Public URL (share with anyone)
- No need to run dev server
- Better performance (optimized build)

**Options**:

**Vercel** (Recommended):
```bash
npm install -g vercel
npm run build
vercel deploy
```

**Netlify**:
```bash
npm run build
# Drag dist/ folder to netlify.com/drop
```

**GitHub Pages**:
```bash
npm run build
# Push dist/ to gh-pages branch
```

### 2. Share with Users

Once deployed, share the production URL:
```
https://ar-fitness-app.vercel.app
```

Users can:
- ✅ Access from any device
- ✅ No setup required
- ✅ Full camera access (HTTPS)
- ✅ Production performance

### 3. Iterate Based on Feedback

- Monitor user behavior
- Fix bugs discovered in real use
- Add new exercises
- Improve pose detection
- Enhance UI/UX

---

## 💡 Pro Tips

### Development Workflow

**Hot Reloading**:
- Save any file → Browser auto-refreshes
- No need to restart server
- Changes appear instantly

**Console Debugging**:
- Press `F12` → Console tab
- View errors, logs, network
- Test camera API directly

**Test Mode**:
- Still available on localhost if needed
- Set `enableTestMode={true}` in CameraFeed
- Useful for development without camera

### Mobile Development

**Remote Debugging**:
- **Android**: Chrome → `chrome://inspect`
- **iOS**: Safari → Develop → [Device]
- Full DevTools on mobile!

**Best Testing Device**:
- iPhone 12+ or recent Android (2020+)
- Good camera quality
- Modern browser support

---

## 📝 Summary

### What We've Covered

1. ✅ **Export** from Figma Make
2. ✅ **Extract** and setup project
3. ✅ **Install** dependencies
4. ✅ **Run** development server
5. ✅ **Test** on desktop (with real camera)
6. ✅ **Setup** HTTPS for mobile
7. ✅ **Test** on mobile device
8. ✅ **Troubleshoot** common issues

### Key Takeaways

**Figma Make**:
- Camera blocked (iframe security)
- Test Mode auto-activates
- Expected behavior

**Localhost**:
- ✅ Real camera works!
- HTTP sufficient for desktop
- HTTPS recommended for mobile

**Production**:
- Best experience
- No restrictions
- Full functionality

---

## 🎉 You're Ready!

Follow this workflow:

```bash
# 1. Export from Figma Make
# 2. Extract ZIP
# 3. Open terminal in project folder

cd ar-fitness-app

# 4. Install dependencies
npm install

# 5. Start server
npm run dev

# 6. Open browser
# → http://localhost:5173

# 7. For mobile: Setup HTTPS (see guide)
# 8. Test on phone: https://YOUR_IP:5173
```

**Need detailed help?** → [QUICK_START.md](./QUICK_START.md)

**Camera issues?** → [CAMERA_TROUBLESHOOTING.md](./CAMERA_TROUBLESHOOTING.md)

**Mobile testing?** → [MOBILE_TESTING_GUIDE.md](./MOBILE_TESTING_GUIDE.md)

---

**🏋️ Happy fitness tracking! Your AR form correction app is ready to help users perfect their technique.**
