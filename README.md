# 🌍 Pixel World
### *Stone Age Meets Code Magic*

[![Play Demo](https://img.shields.io/badge/🌍_Play_Demo-ff6600?style=for-the-badge&logo=github&logoColor=white)](https://FREECANDY-DEV.github.io/pixel-world/demo.html?demo=1)
[![Stars](https://img.shields.io/github/stars/FREECANDY-DEV/pixel-world?style=for-the-badge&color=ffd23f&logo=github)](https://github.com/FREECANDY-DEV/pixel-world)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

> **Every pixel you see is painted by code at runtime — zero image assets loaded.**
> One seed spawns infinite deserts, jungles, snowy peaks, and secret caves. Your tribe gathers around a flickering campfire, discovers fire, explores the ocean, and lives through a full 365-day seasonal calendar — *all rendered in real time!*

---

## 🚀 Live Demo — Play With Friends!

Click the button above or go to **[freecandy-dev.github.io/pixel-world](https://FREECANDY-DEV.github.io/pixel-world/demo.html?demo=1)** — enter the world beside the campfire, meet other adventurers, and explore together. **No accounts, no downloads — just pure WebSocket magic.**

> 💡 **Tip:** On the landing page, tap the **📦 Assets** pill to browse every generated sprite and animation in a full-screen gallery!

---

## ✨ Features

| | Feature | Details |
|---|---------|---------|
| 🌱 | **Infinite Procedural Worlds** | Every seed generates unique continents, rivers, lakes, mountain ranges, and cave systems |
| 🌦️ | **Dynamic Seasons & Weather** | Full 365-day cycle — spring blossoms → summer heat → autumn gold → winter snow, with temperature, lightning, and cloud systems |
| 👥 | **Real-time Multiplayer** | MQTT-powered — walk around with friends, chat by the campfire, no sign-up required |
| 🎨 | **Zero Asset Files** | All 25 vegetation species, 6 fish, villagers, organs, icons — painted by code |
| 🧬 | **Villager Simulation** | Birth, aging, health, anatomy (organs + bones), day/night sleep cycles, squad AI |
| ⚔️ | **Survival & Evolution** | Stone Age → Medieval → Modern → Sci-Fi: weapons, housing, vehicles, wildlife |

---

## 🌲 The World — 25 Vegetation Species

A year in the forest — spring blossoms, summer canopy, autumn gold, winter snow:

![A year in the forest](docs/assets/seasons-forest.gif)

Every tree and bush is hand-pixeled by code painters. Here are some highlights:

| | | | | |
|:---:|:---:|:---:|:---:|:---:|
| ![oak](docs/assets/spritesheet/species-oak.png) | ![pine](docs/assets/spritesheet/species-pine.png) | ![birch](docs/assets/spritesheet/species-birch.png) | ![maple](docs/assets/spritesheet/species-maple.png) | ![palm](docs/assets/spritesheet/species-palm.png) |
| **Oak** | **Pine** | **Birch** | **Maple** | **Palm** |
| ![jungle](docs/assets/spritesheet/species-jungle.png) | ![cactus](docs/assets/spritesheet/species-cactus.png) | ![bamboo](docs/assets/spritesheet/species-bamboo.png) | ![acacia](docs/assets/spritesheet/species-acacia.png) | ![snowpine](docs/assets/spritesheet/species-snowpine.png) |
| **Jungle** | **Cactus** | **Bamboo** | **Acacia** | **Snow Pine** |
| ![apple](docs/assets/spritesheet/species-apple.png) | ![berry](docs/assets/spritesheet/species-berry.png) | ![bloom](docs/assets/spritesheet/species-bloom.png) | ![spruce](docs/assets/spritesheet/species-spruce.png) | ![dead](docs/assets/spritesheet/species-dead.png) |
| **Apple** | **Berry Bush** | **Blossom** | **Spruce** | **Dead Tree** |
| ![agave](docs/assets/spritesheet/species-agave.png) | ![shrub](docs/assets/spritesheet/species-shrub.png) | ![tumble](docs/assets/spritesheet/species-tumble.png) | ![fern](docs/assets/spritesheet/species-fern.png) | ![frostbush](docs/assets/spritesheet/species-frostbush.png) |
| **Agave** | **Shrub** | **Tumbleweed** | **Fern** | **Frost Bush** |
| ![pebble](docs/assets/spritesheet/species-pebble.png) | ![rock](docs/assets/spritesheet/species-rock.png) | ![boulder](docs/assets/spritesheet/species-boulder.png) | ![greatbush](docs/assets/spritesheet/species-greatbush.png) | ![bramble](docs/assets/spritesheet/species-bramble.png) |
| **Pebble** | **Rock** | **Boulder** | **Great Bush** | **Bramble** |

Full vegetation atlas:

![Tree atlas](docs/assets/spritesheet/tree-atlas.png)

---

## 🐟 The Sea — 6 Fish Species

Two-frame swim cycles, depth-submerged schools, distance-culled for performance:

![Fish swim cycle](docs/assets/fish-swim.gif)
![All six fish](docs/assets/fish-school.gif)

| ![sardine](docs/assets/spritesheet/fish-sardine.png) | ![clownfish](docs/assets/spritesheet/fish-clownfish.png) | ![blue tang](docs/assets/spritesheet/fish-blue-tang.png) | ![angelfish](docs/assets/spritesheet/fish-angelfish.png) | ![puffer](docs/assets/spritesheet/fish-puffer.png) | ![tuna](docs/assets/spritesheet/fish-tuna.png) |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **Sardine** | **Clownfish** | **Blue Tang** | **Angelfish** | **Puffer** | **Tuna** |

![Fish atlas](docs/assets/spritesheet/fish-atlas.png)

---

## 👤 Villagers & Characters

Every villager is procedurally generated with unique hair, beard, skin, and clothing variants:

![Villager variants](docs/assets/villagers-animated.gif)

Sleep pose with rising ZZZ:

![Sleeping villager](docs/assets/villager-sleep.gif)

**Special characters:**
- 🟡 **Subject-Zero** — Yellow Hazmat Suit operative with pixel helmet visor, biohazard emblem, and hazard boots
- 🏕️ **Eden Haven Family** — Adam, Eve, Cain & Abel with unique fleeing AI and `!` reaction bubbles

---

## 🔥 Camp, Fire & Lighting

![Campfire flicker](docs/assets/campfire-flicker.gif)

- **Dual animated pixel flames** with warm point lights and radial fire glow halos
- **Cyan hologram shader** — scanlines, micro-flicker, camera billboarding
- **Lightning flash** with expanding shockwave rings
- **Day/night celestial cycle:**

![Day & night cycle](docs/assets/day-night-sky.gif)

---

## 🫀 Anatomy System

Full body view with organ sprites — tap 🫀 on any villager:

| ![heart](docs/assets/spritesheet/organs-heart.png) | ![brain](docs/assets/spritesheet/organs-brain.png) | ![lungs](docs/assets/spritesheet/organs-lungs.png) | ![stomach](docs/assets/spritesheet/organs-stomach.png) | ![liver](docs/assets/spritesheet/organs-liver.png) | ![guts](docs/assets/spritesheet/organs-guts.png) |
|:---:|:---:|:---:|:---:|:---:|:---:|
| **Heart** | **Brain** | **Lungs** | **Stomach** | **Liver** | **Guts** |
| ![skull](docs/assets/spritesheet/organs-skull.png) | ![spine](docs/assets/spritesheet/organs-spine.png) | ![pelvis](docs/assets/spritesheet/organs-pelvis.png) | ![armbone](docs/assets/spritesheet/organs-armbone.png) | ![legbone](docs/assets/spritesheet/organs-legbone.png) | |
| **Skull** | **Spine** | **Pelvis** | **Arm Bone** | **Leg Bone** | |

---

## ⚔️ Survival & Evolution Assets

**26 code-painted pixel art assets** spanning human evolution — Stone Age → Medieval → Modern → Sci-Fi:

### 🦣 Wildlife
`mammoth` · `sabertooth` · `boar` · `rabbit` · `eagle` · `bee`

### 🏚️ Housing (by era)
`thatchhut` · `logcabin` · `stonecottage` · `concretebunker` · `cyberhab`

### ⚔️ Weapons
`flintspear` · `ironsword` · `tacticalrifle` · `plasmasaber`

### 🚗 Vehicles
`chariot` · `survivaljeep` · `hovercraft`

### 🦈 Marine Predators
`greatwhite` · `octopus` · `seaturtle`

### 🪵 Resources & Props
`woodpile` · `poppy` · `sunflower` · `beehive` · `ironore`

> 📋 Full technical reference with pixel art and palettes → **[SPRITESHEET.md](SPRITESHEET.md)**

---

## 🎮 Controls

| Action | Keyboard | Touch / Mobile |
|--------|----------|----------------|
| Rotate camera | Mouse drag / `← ↑ ↓ →` | Drag finger |
| Move | `W A S D` | Virtual joystick |
| Fly up / down | `R` / `F` | Up / Down buttons |
| Box-select villagers | Click & drag | Drag on screen |
| Toggle assets panel | Click `»` button | Tap icon |
| Toggle UI | Click 👁 | Tap eye button |
| Regenerate world | 🌍 button | Button on rail |
| Top-view camera | 🗺️ button | Button on rail |
| Pause / resume time | `Space` | Tap ❚❚ |
| Speed up time | ×2 / ×4 / ×6 / ×10 / ×25 buttons | Same |

---

## 🛠️ Run Locally

```bash
git clone https://github.com/FREECANDY-DEV/pixel-world.git
cd pixel-world
npm install
npm run dev
```

Open `http://localhost:3000` — the entire game is **plain JavaScript modules** with a single entry point in `main.js`.

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b my-feature`)
3. Make changes & ensure the demo still works
4. Open a Pull Request with screenshots

Please keep the **no-asset philosophy** intact — everything is painted by code!

---

## 📜 License

**MIT** — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <i>Every pixel, every tree, every fish — painted by code. Welcome to the tribe. 🔥</i>
</p>

