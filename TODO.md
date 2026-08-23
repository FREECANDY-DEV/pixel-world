# Pixel World — Project TODO

Last updated: 2026-08-23 (v38)

---

## ✅ Completed

### Online demo mode — multiplayer campfire chat (v38)
- [x] **Demo entry** (`?demo=1`, landing at `demo.html`): spawns your own caveman on dry
  ground beside the camp, gives you a random stone-age name (✏️ to change — the tribe sees
  it), selects & follows you
- [x] **Multiplayer with zero accounts**: the demo rides a public MQTT broker over WebSockets
  (HiveMQ → EMQX fallback), mqtt.js loaded from a CDN only in demo mode; the page stays pure
  static so it also runs from GitHub Pages
- [x] **Remote players as ghosts**: every visitor's human appears in your world as a ghost
  caveman with a colored name tag, positions smoothed and throttled (~160ms / 0.22u move)
- [x] **Chat bubbles above humans**: messages pop as pixel bubbles over the speaker's head,
  seen by everyone; chat log panel bottom-left with online counter
- [x] **Grunk the Elder**: a knowledge NPC by the fire who answers questions about the game
  (seasons, fish, species, fire/water knowledge, energy/sleep, controls, world) from live
  game state. One client is elected bot-host (retained-topic election) so his replies are
  world-synced; solo/offline camp still chats locally
- [x] **Cleanup**: MQTT Last-Will tombstones drop departed players' ghosts + presence;
  45s silence TTL as a backstop
- [x] Headless-verified: two real browser clients discovered each other, exchanged chat both
  ways, saw the same world-synced bot reply, and the departing client's ghost was removed

### Sea, action menu & classic party window (v37)
- [x] **Fish swim properly**: each school cruises in its own random direction
  (per-school heading rotates the orbit) with per-fish phases; schools are
  clamped to 1.4–4.5 blocks below the surface (never nearer than 0.5 to the
  seabed) so they read as swimming inside the water, not on top of it
- [x] **Zoom-scaled fish radius**: fish are visible within a small radius when
  the camera is close (you see the lively shoals near you) and spread across
  the whole sea as you pull back
- [x] **Map fish markers**: the zoomed-out sea shows a handful of spread fish
  dots per water body (thinned to ~40u apart, capped per body) instead of one
  lonely pixel, all floating above the waves on a depth-less layer so they
  never drown under the water
- [x] **Sea-floor map chips**: four new pixel-art map icons — rock, seaweed,
  coral and shell — scattered across the shallows and shown on the map
  (icon atlas now 38 columns)
- [x] **Action options menu**: in Move mode, tapping another human highlights
  them in white and opens a small popup — Pick up & carry (the selected human
  walks over and hoists them), Add to party, Cancel. Party members just get
  selected as the lead instead.
- [x] **No random walking while acting**: with Move armed, or while the options
  menu is open on someone, nobody wanders — the pick, the party and the
  highlighted target all hold still
- [x] **Classic party window** (right edge): every picked human as an RPG row
  — pixel face, name, age, health bar and energy bar — plus a Next ▸ button to
  cycle the controlled human and scrolling through the whole party

### Carry & party roster (v36)
- [x] **Hoist & carry**: with the Move command armed, tapping another human picks them up
  — they dangle over the carrier's head (gentle sway) and ride along while the carrier
  walks, steers or is sent with the Move command. Tap the carried human again to set them
  down; disarming Move or deselecting drops everyone.
- [x] One at a time: a carrier with a full load can't pick up a second; busy carriers
  can't be lifted; selecting a dangling human sets them down first so you can steer them
- [x] Carried humans stop being their own person: no AI wander, no squad trailing, no
  gathering, no commands — they just ride
- [x] **Floating party roster (bottom-right)**: a scrollable list of every selected
  human, with live pixel face, name, age · condition, and YOU / 🫳 carry / lifted badges.
  Click any row to make them the one you control (camera glides over). Shows the squad
  when one exists, else your solo pick; hides when nothing is selected.
- [x] Carries are dropped safely on death, and carried villagers wake before hoisting

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
- [x] **v35 late transparent render pass**: vegetation and map icons now render in the
  late transparent pass (depth-TEST on, depth-WRITE off, `renderOrder` 2 / 4), so sprites
  and markers are never overwritten by the terrain they stand on, while real hills still
  occlude things behind them

### Flora & assets
- [x] 25 plant/rock species incl. Blossom Bush + Bramble Tangle
- [x] **Professional tree art pass**: shaded bark (`ttrunk`: lit edge, knots, root flare),
  volumetric canopies (`tcanopy`: AO under-layer, lit cap, dithered shine, depth holes)
  applied to Oak, Pine, Birch, Maple, Spruce, Snow Pine
- [x] Fish: denser schools, larger sprites, two-tail animation frames
- [x] **v34 fish visibility**: schools now break the water surface (y = sea level +0.02),
  render above the water plane (renderOrder 6), depth-biased against the floor,
  brighter tint + frustumCulled off so border schools always draw
- [x] **v35 fish overhaul**: schools are now *sparse & deep* — one per ~7.5-unit cell at
  ~45% fill, cruising fully submerged 1.8–4+ blocks below the surface (never scraping the
  seabed), distance-culled beyond 320 units, so the sea reads as occasional passing shoals
  instead of a constant rain of pixels
- [x] Map icon system: tree icons + clustered fish-school markers (12u grid dedupe)

### Map icons (v35 — seasonal & per-species)
- [x] **Seasonal tree chips**: zoomed-out tree markers show the *exact* art the in-world
  tree shows right now — the same two season atlas rows the wind shader blends, mixed at
  the same weight (icon atlas rebuilds whenever the season or its quantised blend changes).
  Spring blossoms, autumn gold and winter snow all appear on the map.
- [x] Markers float just above the tallest tree in their cluster (top + 1.6u), so no
  canopy or block face can hide them from any camera angle
- [x] **Per-species fish chips**: one swimmer chip per fish species (6 columns)
- [x] **Water-body flood-fill markers**: the loaded sea floor is flood-filled into
  connected deep-water bodies (3+ blocks) and ONE marker is emitted per (water body,
  species) — a whole ocean shows at most six spots, one per fish type, instead of a
  scatter of clone icons

### Villagers (humans)
- [x] Unique looks per villager (skin/hair/eyes/style/beard), aging stages, anatomy view
- [x] Selection + squad commands, joystick/WASD steering with velocity damping
- [x] **Selected humans never move on their own** — they hold position until the stick is
  pushed (deep-water safety paddle is the only exception)
- [x] Sleep system: lying pose art (closed eyes), ZZZ rising glyphs, wake-on-select/steer hop
- [x] Campfire gathering (golden-angle ring slots, excitement decay, reaction bubbles)
- [x] Lightning strikes, shockwave physics, world-edge safety

### Move command + squad follow (v35)
- [x] **Move command (⛳)**: a floating button rides above the selected human — arm it
  (turns green, label reads "Go…") and a tap on the world sends the picked human walking
  there; a little green pixel flag marks the destination. Disarming cancels the order.
- [x] Commands rouse sleepers, cancel gathering, and commanded humans *hold position* if
  the target turns out unreachable instead of drifting back into idle wandering
- [x] **Squad follow AI**: squad mates trail the lead human at personal random offsets —
  fanning out *behind* a walking leader (2.2–4.6u back, ±2.5u sideways), spreading around
  a standing one (1.6–4.2u ring), and converging on the leader itself if they fall more
  than 6.5u behind or get blocked by terrain
- [x] Followers hustle up to +65% faster the further they lag, so the pack never strings
  out behind the leader; offsets re-roll only when caught up or lost, so they trail
  smoothly instead of zig-zagging
- [x] **Command-green highlight**: the selection stroke turns green while the Move command
  is armed, yellow otherwise; the stroke now hugs the *lying* pose of a sleeping pick
  (built from the baked sleep art instead of the standing ghost)

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
  tpVillager/setStick/day/depthAt/fishState/icon mode…). **v19** adds `action()` /
  `move(x, z)` / `squadAdd(cm)` for the Move command, plus `fishIconLayer`,
  `rebuildIconAtlas()`, `seasonNow()` and `state()` for the icon & fish systems

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
