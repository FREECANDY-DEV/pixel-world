# Pixel World — Project TODO

Last updated: 2026-08-22 (v34)

---

## ✅ Completed

### World & rendering
- [x] Procedural voxel terrain: biomes (desert / jungle / forest / snow), beaches, sea, caves
- [x] Day/night cycle with sun/moon discs, stars, dusk tones; seasons + weather (snow, drought)
- [x] Wind-animated instanced vegetation billboards w/ regional wind fields
- [x] Seasonal crossfade textures (spring / summer / autumn / winter rows per species)
- [x] Space mode (planet view), top view, icon LOD mode for far chunks
- [x] Camera tweens (home framing, campfire strike reframe) with cubic easing
- [x] **Asset occlusion fixes** — sprites no longer sink into blocks at grazing angles:
  smaller edge-slide, stronger low-sprite rise/clearance, distance-faded depth bias
  (`main.js` vegetation vertex shader)
- [x] **v34 occlusion hardening**: eye-level (grazing-angle) view-depth advantage for
  rocks/bushes — up to 16 units of view-Z at horizontal views, fading to zero top-down,
  so neighbouring terrain rows can never swallow them

### Flora & assets
- [x] 26 plant/rock species incl. Blossom Bush + Bramble Tangle
- [x] **Professional tree art pass**: shaded bark (`ttrunk`: lit edge, knots, root flare),
  volumetric canopies (`tcanopy`: AO under-layer, lit cap, dithered shine, depth holes)
  applied to Oak, Pine, Birch, Maple, Spruce, Snow Pine
- [x] Fish: denser schools, larger sprites, two-tail animation frames
- [x] **v34 fish visibility**: schools now break the water surface (y = sea level +0.02),
  render above the water plane (renderOrder 6), depth-biased against the floor,
  brighter tint + frustumCulled off so border schools always draw
- [x] Map icon system: tree icons + clustered fish-school markers (12u grid dedupe)

### Villagers (humans)
- [x] Unique looks per villager (skin/hair/eyes/style/beard), aging stages, anatomy view
- [x] Selection + squad commands, joystick/WASD steering with velocity damping
- [x] **Selected humans never move on their own** — they hold position until the stick is
  pushed (deep-water safety paddle is the only exception)
- [x] Sleep system: lying pose art (closed eyes), ZZZ rising glyphs, wake-on-select/steer hop
- [x] Campfire gathering (golden-angle ring slots, excitement decay, reaction bubbles)
- [x] Lightning strikes, shockwave physics, world-edge safety

### Knowledge book 📖 (new in v28)
- [x] Book button (top-left, under Assets) opening a right-side panel
- [x] Huge tree-view menu: connector branches, locked 🔒 / unlocked states, detail pane
- [x] **Fire** knowledge unlocked by striking the campfire
- [x] **Water** knowledge unlocked when a commanded villager wades into the sea
- [x] Golden toast notification with knowledge icon for every unlock
- [x] Stubbed future nodes visible in the tree: Toolmaking, Farming, Writing, The Wheel
- [x] Knowledge persists across sessions (localStorage `pw-knowledge`)
- [x] Water fear rule: villagers refuse wet wander targets until Water is known;
  afterwards shallow wading becomes allowed

### Energy system ⚡ (new in v28)
- [x] Per-villager daily battery (0–100), drains ~4.6/game-hour awake
- [x] Sleeping regenerates ~26/game-hour (one full night ≈ full bar)
- [x] Energy bar drawn on every name tag (amber→red, blue while asleep, `zZ` glyph)
- [x] Collapse at zero → forced sleep until 42% restored
- [x] Bedtime AI: dark nights send tired villagers to sleep where dusk catches them
- [x] Dawn wake: rested villagers rise automatically with the sun

### UI & misc
- [x] Assets panel (biome tabs incl. Sea Life showcase), character panel, anatomy view
- [x] Toast chat stream, time controls ×1–×25 + pause, globe camp stats popup
- [x] Debug hooks `window.__DBG` for headless testing (strike/know/unlock/energy/setHour/
  tpVillager/setStick/day/depthAt/fishState/icon mode…)

---

## 🔜 Future work — gameplay

- [ ] **Toolmaking node**: gather stones → craft stone tools (unlock by picking up a rock?)
- [ ] **Farming node**: plant berry seeds near camp → berry bushes grow over days
- [ ] **Writing node**: unlock after N knowledge points; adds chronicle/history panel
- [ ] **The Wheel**: cart placement asset + faster transport between camp and shore
- [ ] Hunger layer feeding into energy (eat berries/fish to restore faster)
- [ ] Sleep quality: villagers prefer sleeping *at the camp* — walk home before curling up;
      sleeping on cold snow drains health slowly
- [ ] Knowledge prerequisites (tree tiers: Fire+Water → Tools → Farming …) and a
      "generations" counter tying discoveries to camp age
- [ ] Predators / threats that fear fire radius once Fire is known
- [ ] Fishing behaviour after Water knowledge (stand at shoreline, catch fish)

## 🔜 Future work — art polish (already-built areas that deserve better)

- [ ] Remaining tree painters still flat-style: Palm, Jungle Tree, Acacia, Bamboo, Dead
      Tree, Apple, Cactus, Agave — port them onto `ttrunk`/`tcanopy`
- [ ] Rock painters (pebble/rock/boulder): facet shading + moss/snow caps per biome
- [ ] Bush family consistency pass (shrub, fern, frostbush, greatbush, bramble, bloom)
- [ ] Campfire art: ember glow pixels + charred logs variant after big storms
- [ ] Caveman sleep art could get a breathing offset frame (2-frame chest rise)
- [ ] Fish: add a rare golden fish easter egg with its own map chip

## 🔜 Future work — systems/QoL

- [ ] Full save/load: villager positions, placed trees, world seed, time of day
- [ ] Settings panel: toggle energy drain speed, knowledge reset button
- [ ] Mobile layout audit of the book panel (safe-area insets, landscape)
- [ ] Performance: cap name-tag redraws during mass sleep transitions
- [ ] Sound: crackling fire at camp, waves near shore, night crickets
- [ ] Localization-ready strings for all UI panels
