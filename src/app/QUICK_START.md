# ⚡ Quick Start Guide - 5 Minutes to Running

Get your AR fitness app running on localhost in 5 minutes.

---

## 🎯 Prerequisites (1 minute)

✅ **Node.js installed?** Check with:
```bash
node --version
```
❌ **Not installed?** Download: https://nodejs.org/ (get LTS version)

✅ **VS Code installed?** 
❌ **Not installed?** Download: https://code.visualstudio.com/

---

## 📦 Step 1: Export Project (30 seconds)

### From Figma Make:
1. Click **three-dot menu** (top right)
2. Select **"Export Project"**
3. Save ZIP file
4. **Extract** to folder (e.g., `Desktop/ar-fitness-app`)

---

## 💻 Step 2: Open in VS Code (30 seconds)

### Method A: Drag & Drop
- Drag your project folder onto VS Code icon

### Method B: Command Line
```bash
cd Desktop/ar-fitness-app
code .
```

### Method C: From VS Code
- File → Open Folder → Select your project folder

---

## 📦 Step 3: Install Dependencies (2 minutes)

### Open Terminal in VS Code:
- **Windows/Linux**: Press `Ctrl + ` (backtick)
- **Mac**: Press `Cmd + ` (backtick)
- Or: Menu → Terminal → New Terminal

### Run:
```bash
npm install
```

**Wait for it...** ☕ (Takes 1-2 minutes)

You should see:
```
added 500+ packages in 30s
```

---

## 🚀 Step 4: Start Dev Server (10 seconds)

```bash
npm run dev
```

Look for:
```
  VITE v5.x.x  ready in 500 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.100:5173/
```

---

## 🌐 Step 5: Open in Browser (10 seconds)

1. Open **Chrome** (recommended)
2. Go to: `http://localhost:5173`
3. Click **"Allow"** when asked for camera permission
4. **You're live!** 🎉

---

## 📱 BONUS: Test on Mobile (2 minutes)

### Step 1: Note Your Network IP

From the terminal output, find the "Network" URL:
```
➜  Network: http://192.168.1.100:5173/
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^
           Copy this!
```

Or find it manually:

**Windows:**
```bash
ipconfig
```
Look for: `IPv4 Address: 192.168.1.xxx`

**Mac/Linux:**
```bash
ifconfig | grep "inet "
```
Look for: `inet 192.168.1.xxx`

### Step 2: Open on Phone

**Requirements:**
- Phone on **same WiFi** as computer
- Dev server still running

**On your phone:**
1. Open **Chrome** (Android) or **Safari** (iOS)
2. Type in address bar: `http://192.168.1.100:5173`
   - Replace with YOUR IP from Step 1
3. Allow camera permission
4. Test away! 📱

**Not working?** See [CAMERA_TROUBLESHOOTING.md](./CAMERA_TROUBLESHOOTING.md)

---

## ⚠️ Troubleshooting

### "npm: command not found"
❌ **Problem**: Node.js not installed  
✅ **Solution**: Install from https://nodejs.org/

### "Port 5173 is already in use"
❌ **Problem**: Another app using port  
✅ **Solution**: 
```bash
npm run dev -- --port 3000
```

### Camera Blocked
❌ **Problem**: Permission denied  
✅ **Solution**: 
1. Click lock icon 🔒 in browser
2. Camera → Allow
3. Refresh page

### Mobile Can't Connect
❌ **Problem**: Can't reach server  
✅ **Solution**:
- Verify same WiFi network
- Check IP address is correct
- Try: `npm run dev -- --host`

**Full troubleshooting**: [CAMERA_TROUBLESHOOTING.md](./CAMERA_TROUBLESHOOTING.md)

---

## 🎮 Using the App

### First Time:
1. Click **"Start Calibration"**
2. Follow 8 poses on screen
3. Wait for green checkmarks
4. Complete sequence

### Choose Exercise:
1. Select: Push-ups, Squats, Planks, or Sit-ups
2. Review demonstration
3. Click "Start Exercise"
4. Follow AR overlay
5. Listen for audio feedback

### Tips:
- 📏 **Distance**: 4-6 feet from camera
- 💡 **Lighting**: Face a window/light
- 📱 **Orientation**: Hold phone vertically
- 🎯 **Background**: Clear space helps

---

## 📚 Full Documentation

Need more help?

- **[LOCAL_SETUP_GUIDE.md](./LOCAL_SETUP_GUIDE.md)** - Complete setup with all details
- **[CAMERA_TROUBLESHOOTING.md](./CAMERA_TROUBLESHOOTING.md)** - Camera issues solved
- **[README.md](./README.md)** - Full project overview

---

## ✅ Success Checklist

- [ ] Node.js installed (`node --version`)
- [ ] VS Code opened project folder
- [ ] Terminal opened in VS Code
- [ ] `npm install` completed successfully
- [ ] `npm run dev` running (don't close!)
- [ ] Browser opened to `http://localhost:5173`
- [ ] Camera permission granted
- [ ] Calibration system loads
- [ ] (Optional) Mobile device connected

---

## 🎉 You're Ready!

Your AR fitness app is now running locally with full camera access.

**Next steps:**
1. Test all 8 calibration poses
2. Try each exercise (push-ups, squats, planks, sit-ups)
3. Verify audio feedback triggers
4. Test on mobile device
5. Share with others on your network!

---

## 💡 Pro Tips

### Keep Dev Server Running
- Terminal must stay open
- Server restarts on file changes
- Press `Ctrl+C` to stop server

### Test Mode (Figma Make)
- Auto-activates in Figma iframe
- Simulated camera background
- All features work except live camera
- Real camera works on localhost ✅

### Code Changes
- Save file → Browser auto-refreshes
- No need to restart server
- Hot Module Replacement (HMR) enabled

---

## 🔥 Common First-Time Issues

### "Cannot find module 'react'"
```bash
# Make sure you're in project folder
cd ar-fitness-app
npm install
```

### Black screen in browser
- Check console (F12) for errors
- Ensure camera permission granted
- Try Test Mode if camera blocked

### Calibration won't start
- Ensure camera feed visible
- Click "Start Calibration" button
- Check browser console for errors

---

**⚡ That's it! You should be up and running in under 5 minutes.**

**Having issues?** Check [CAMERA_TROUBLESHOOTING.md](./CAMERA_TROUBLESHOOTING.md) for detailed solutions.
