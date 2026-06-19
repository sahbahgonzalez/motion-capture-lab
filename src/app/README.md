# 🏋️ AR/MR Fitness Form Correction App

A high-fidelity prototype demonstrating real-time fitness form correction using AR/MR interfaces with visual and audio feedback.

---

## 🚀 **Quick Start - Get Running in 5 Minutes!**

### Want to run this locally with **real camera access**?

👉 **[QUICK_START.md](./QUICK_START.md)** - 5-minute setup guide

```bash
npm install
npm run dev
# Open http://localhost:5173
```

### 📚 **Complete Documentation**

- **[DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md)** - All guides in one place
- **[QUICK_START.md](./QUICK_START.md)** - 5-minute local setup
- **[LOCAL_SETUP_GUIDE.md](./LOCAL_SETUP_GUIDE.md)** - Complete local setup instructions
- **[MOBILE_TESTING_GUIDE.md](./MOBILE_TESTING_GUIDE.md)** - Test on iOS/Android devices
- **[CAMERA_TROUBLESHOOTING.md](./CAMERA_TROUBLESHOOTING.md)** - Fix camera issues
- **[EXPORT_AND_RUN.md](./EXPORT_AND_RUN.md)** - Export from Figma Make process

---

## 🎯 Quick Start

### 1️⃣ **Export from Figma Make**
- Click menu → **"Export Project"** or **"Download"**
- Extract ZIP to a folder

### 2️⃣ **Open in VS Code**
```bash
cd ar-fitness-app
code .
```

### 3️⃣ **Install Dependencies**
```bash
npm install
```

### 4️⃣ **Run Development Server**
```bash
npm run dev
```

### 5️⃣ **Open in Browser**
- Go to: `http://localhost:5173`
- **Allow camera access**
- Start testing! 🎉

---

## 📱 Test on Mobile Device

### Prerequisites
- Computer and phone on **same WiFi**
- Development server running (`npm run dev`)

### Steps
1. Find your computer's IP address:
   ```bash
   # Windows
   ipconfig
   
   # Mac/Linux
   ifconfig | grep "inet "
   ```

2. On your mobile browser, visit:
   ```
   http://YOUR_IP_ADDRESS:5173
   ```
   Example: `http://192.168.1.100:5173`

3. Allow camera access and test!

📖 **Full instructions**: See [LOCAL_SETUP_GUIDE.md](./LOCAL_SETUP_GUIDE.md)

---

## ✨ Features

### 🎯 System Calibration
- 8-step calibration sequence
- Real-time position validation
- Visual feedback (red → green when locked)
- 1-second confirmation pause

### 🏋️ Exercise Library
- **Push-ups**: Arm angle detection
- **Squats**: Knee and hip angle monitoring  
- **Planks**: Body alignment tracking
- **Sit-ups**: Core movement analysis

### 📹 Real-Time Analysis
- Live camera feed with AR overlay
- Stick figure visualization
- 1-second interval pose checking
- Joint-specific highlighting

### 🔊 Audio Feedback
- Triggered after 3 consecutive errors
- Clear corrective instructions
- "Good form" positive reinforcement
- Exercise completion announcements

### 📊 Post-Exercise Analysis
- Performance summary
- Form correction count
- Time tracking
- Visual feedback history

---

## 🛠️ Tech Stack

- **React 18** + **TypeScript**
- **Tailwind CSS** for styling
- **Motion** (Framer Motion) for animations
- **Lucide React** for icons
- **ShadCN UI** components
- **Vite** for fast development

---

## 🎮 How to Use

### First Time Setup
1. Launch app → Click "Start Calibration"
2. Follow 8 calibration poses
3. Wait for green confirmation (1 sec each)
4. Complete calibration sequence

### Exercise Session
1. Select exercise from library
2. Review demonstration walkthrough
3. Get into starting position
4. Follow AR overlay guidance
5. Listen for audio corrections
6. Complete reps and review analysis

---

## 📁 Project Structure

```
ar-fitness-app/
├── App.tsx                      # Main app & routing
├── components/
│   ├── HomePage.tsx             # Landing page
│   ├── CalibrationView.tsx      # 8-step calibration
│   ├── ExerciseSelection.tsx    # Exercise library
│   ├── PreExerciseWalkthrough.tsx  # Instructions
│   ├── LiveExerciseView.tsx     # Real-time tracking
│   ├── PostExerciseAnalysis.tsx # Results summary
│   ├── CameraFeed.tsx           # Camera + test mode
│   ├── StickFigure.tsx          # AR overlay rendering
│   ├── AudioFeedbackIndicator.tsx  # Audio cues
│   └── ui/                      # ShadCN components
└── styles/
    └── globals.css              # Global styles
```

---

## 🔧 Troubleshooting

### Camera Not Working

**Figma Make (Expected)**:
- Camera blocked by iframe security
- App auto-switches to "Test Mode"
- ✅ This is normal!

**Localhost**:
- Click lock icon 🔒 → Camera → Allow
- Check system camera permissions
- Try Chrome browser (recommended)

**Mobile**:
- Use HTTPS for mobile testing (see guide)
- Use Chrome (Android) or Safari (iOS)
- Check mobile camera permissions

### Can't Access on Mobile

- Verify same WiFi network
- Check firewall allows port 5173
- Try `npm run dev -- --host`
- Use IP address, not localhost

### Performance Issues

- Close other camera apps
- Use Chrome for best performance
- Ensure good lighting
- Position 4-6 feet from camera

📖 **Detailed solutions**: See [LOCAL_SETUP_GUIDE.md](./LOCAL_SETUP_GUIDE.md)

---

## 🎯 Testing Checklist

### Desktop
- [ ] Camera access works
- [ ] All 8 calibration poses complete
- [ ] Stick figure overlays correctly
- [ ] Exercise selection functional
- [ ] Audio feedback plays
- [ ] Post-exercise analysis displays

### Mobile
- [ ] App loads on mobile browser
- [ ] Camera permission granted
- [ ] Front camera activates
- [ ] Touch interactions responsive
- [ ] Portrait mode optimized
- [ ] All exercises functional

---

## 🚀 Deployment

### Build for Production
```bash
npm run build
```

### Deploy Options
- **Vercel**: `vercel deploy`
- **Netlify**: Drag & drop `dist/` folder
- **GitHub Pages**: Deploy `dist/` to `gh-pages` branch

**Note**: Production URLs support camera access (no iframe restrictions)

---

## 📝 Development Notes

### Test Mode
- Automatically activated in Figma Make
- Simulated camera background
- All functionality works
- Real camera works on localhost/production

### Camera API
- Uses `getUserMedia()` API
- Front-facing camera preferred
- 1280x720 resolution ideal
- Falls back gracefully

### Pose Detection
- Simulated for prototype
- 1-second analysis intervals
- Threshold-based deviation detection
- Joint-specific feedback

---

## 💡 Best Practices

### For Testing
1. Good lighting (face light source)
2. Clear background
3. Stable phone position (use stand)
4. 4-6 feet distance
5. Portrait orientation

### For Development
1. Test on multiple devices
2. Verify camera permissions flow
3. Test with/without camera
4. Check responsive breakpoints
5. Validate audio feedback

---

## 🎓 Methodology

### Four-Stage System

1. **Calibration**: 8 movements to map joint positions
2. **Demonstration**: Exercise walkthrough with visual guide
3. **Execution**: Real-time pose analysis at 1-sec intervals
4. **Feedback**: Visual (red/green) + Audio (after 3 errors)

### Design Principles
- Mobile-first responsive design
- Progressive enhancement
- Graceful camera fallback
- Clear visual hierarchy
- Immediate feedback

---

## 📞 Support

### Resources
- [LOCAL_SETUP_GUIDE.md](./LOCAL_SETUP_GUIDE.md) - Complete setup instructions
- [CAMERA_TROUBLESHOOTING.md](#) - Camera-specific issues
- Browser console (F12) - Debug information

### Common Issues
- **No camera**: Check permissions (browser + system)
- **Mobile can't connect**: Same WiFi + firewall
- **Slow performance**: Close other apps, good lighting
- **Calibration stuck**: Refresh and retry

---

## 🎉 You're Ready!

```bash
npm install
npm run dev
```

Open `http://localhost:5173` and start testing your AR fitness form correction app!

For mobile testing, see [LOCAL_SETUP_GUIDE.md](./LOCAL_SETUP_GUIDE.md) for complete instructions.

---

**Built with ❤️ for high-fidelity AR/MR fitness prototyping**