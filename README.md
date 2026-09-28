# SreeGeo - Mobile GeoTag Camera App (PWA)

A Progressive Web App (PWA) that installs directly on mobile devices (Android & iOS) as a native-feeling camera app with automatic GPS coordinates stamping, offline caching, and SQLite cloud/local gallery synchronization.

---

## 📱 Mobile App Features

1. **Native 1-Screen Camera Experience**:
   - Zero scrolling needed on mobile — edge-to-edge camera viewfinder.
   - Large tactile central **Camera Shutter Button**.
   - Front/Back Camera flip switch button.
2. **On-Demand GPS Location**:
   - `📍 Turn on GPS` floating button.
   - GPS runs only when the user requests it or captures a photo.
   - High-accuracy GPS with automatic reverse geocoding to retrieve street address, district, state, and pin code.
3. **PWA Standalone App**:
   - **No Browser Bar**: Launches in standalone full screen.
   - **Home Screen App Icon**: Custom high-resolution SreeGeo vector app icon.
   - **Offline Capability**: Cached with Service Worker (`sw.js`).
   - SQLite database for persistent photo storage and downloads.

---

## 🚀 How to Run the App

1. **Start the local server**:
   ```bash
   npm run dev
   ```
   The app will run at `http://localhost:3000`.

2. **Access on your Mobile Phone**:
   - Make sure your mobile phone and computer are on the same Wi-Fi network.
   - Find your computer's local IP address (e.g., `ipconfig` on Windows, usually `192.168.x.x`).
   - Open your mobile browser and navigate to:
     ```
     http://<YOUR_COMPUTER_IP>:3000
     ```

---

## 📲 How to Install on Mobile Devices

### 🤖 Android (Google Chrome / Brave)
1. Open the URL in Google Chrome.
2. Look for the top **`📲 Install App`** button, or tap the three dots **(⋮)** in the browser's top-right corner.
3. Tap **"Install App"** (or **"Add to Home screen"**).
4. The **SreeGeo** icon will appear on your phone's home screen and app drawer.
5. Tap the icon to launch SreeGeo in full-screen standalone mode without any browser URL bar!

### 🍏 iPhone / iPad (Apple Safari)
1. Open the URL in Apple Safari.
2. Tap the **Share** button (the square with an arrow pointing up at the bottom).
3. Scroll down and tap **"Add to Home Screen"** (`+`).
4. Tap **"Add"** in the top-right corner.
5. SreeGeo is now installed on your iOS home screen!
