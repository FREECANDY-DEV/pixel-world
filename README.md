# 🎉 Pixel World: Stone Age Meets Code Magic!

## 🌍 Overview
Welcome to **Pixel World**, a playful, procedurally‑generated sandbox where every tree, rock, fish, and caveman is drawn on‑the‑fly with pure JavaScript. No image assets – everything is rendered in real‑time using *Three.js* and pixel‑art style shaders.

- **Infinite worlds** – each seed creates a unique landscape of deserts, jungles, snowy peaks, and hidden caves.
- **Dynamic seasons** – a full 365‑day cycle changes lighting, foliage, and weather.
- **Multiplayer** – hop into the same world with friends via WebSockets, no accounts required.
- **Zero assets** – the entire visual style is generated algorithmically, making the game lightweight and fun to extend.

---

## 🚀 Live Demo
Jump straight into the action:

[![Play Demo](https://img.shields.io/badge/Play‑Demo-ff6600?logo=github)](https://FREECANDY-DEV.github.io/pixel-world/demo.html?demo=1)

Just open the link, pick a name, and start exploring!

---

## 📦 All Assets & Animations Archive
On the landing page you’ll see a tiny 📦 **archive icon** in the top‑right corner of the *Assets* panel. Click it to open a full‑screen gallery showcasing every generated sprite and its smooth animation loops – from 25 plant/rock species to 6 fish and the quirky cavemen.

---

## 🎮 Controls
| Action | Keyboard | Touch / Mobile |
|--------|----------|----------------|
| Rotate camera | `← ↑ ↓ →` (or mouse drag) | Drag finger |
| Move / Fly | `W A S D` (walk) / `R/F` (rise/fall) | Virtual joystick + up/down buttons |
| Box‑select villagers | Click & drag on map | Drag on screen |
| Open assets panel | `E` (or click the 📦 icon) | Tap the icon |
| Toggle UI | `U` | Tap eye button |
| Regenerate world | `⌘` / `Ctrl` + `R` | Button on the rail |
| Top‑view camera | `T` | Button on the rail |
| Pause time | `Space` | Tap pause button |

---

## 🛠️ Development
```bash
# Clone the repo
git clone https://github.com/FREECANDY-DEV/pixel-world.git
cd pixel-world

# Install dependencies (uv or npm)
uv pip install -r requirements.txt   # if using uv
npm install                         # install Node deps (Three.js, etc.)

# Run the dev server
npm run dev                         # will start a local server at http://localhost:3000
```
The project uses **plain JavaScript modules**; the main entry point is `main.js`. Feel free to explore the code – the procedural generation functions live near the top of that file.

---

## 🤝 Contributing
We love community ideas! To contribute:
1. Fork the repository.
2. Create a feature branch (`git checkout -b my‑awesome‑feature`).
3. Make your changes and ensure the demo still works.
4. Open a Pull Request with a clear description and screenshots if applicable.

Please follow the existing coding style and keep the **no‑asset** philosophy intact.

---

## 📜 License
This project is released under the **MIT License** – see the `LICENSE` file for details.

---

*Enjoy building your own pixel‑perfect prehistoric adventure!*
