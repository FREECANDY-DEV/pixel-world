# Pixel World — Spritesheet Reference

All pixel art is generated at runtime by painter functions in `main.js` — no image files.
This document catalogs every sprite, where it lives, and what it looks like.

---

## 1. Vegetation Atlas — `treeAtlasCanvas`

- Cell size: **48×48 px**, one column per species (`ATLAS_CELL`), ground line ≈ y 46.
- 4 season rows per column: spring (row 0), summer (row 1), autumn (row 2), winter (row 3).
- Autumn/winter rows are derived from the painted summer base by `deriveSeasons()`
  (hue-shift to the species `autumn` color, snow tinting, leaf-drop).
- Uploaded once as `treeAtlasTex` (NearestFilter, SRGB) and sampled by the wind-shader.

| Col | Key | Label | Biome | Description |
|-----|-----|-------|-------|-------------|
| 0 | `cactus` | Cactus | desert | Green saguaro column with lighter highlight edge, dark ribs, two side arms, spines dots. |
| 1 | `agave` | Agave | desert | Rosette of stiff pointed leaves fanning from a dry centre, blue-green tones. |
| 2 | `acacia` | Acacia | desert | Tall slim dark trunk, flat wide umbrella canopy, dusty olive greens; turns ochre in autumn. |
| 3 | `shrub` | Desert Shrub | desert | Low scrubby ball of twiggy grey-green stems. |
| 4 | `tumble` | Tumble Bush | desert | Round skeletal tumbleweed, tan criss-cross branches. |
| 5 | `jungle` | Jungle Tree | jungle | Massive broadleaf: thick trunk, huge layered canopy blobs, deep greens. |
| 6 | `palm` | Palm | jungle | Curved ringed trunk leaning with the wind, 7 arcing fronds, coconut cluster at the crown. |
| 7 | `bamboo` | Bamboo | jungle | Cluster of segmented yellow-green culms with leaf tufts; autumn golds. |
| 8 | `fern` | Fern Thicket | jungle | Low spread of arching fronds. |
| 9 | `oak` | Oak | forest | **Pro-art pass**: shaded bark trunk (lit left edge, knots, root flare) + volumetric canopy (AO under-mass, lit upper-left cap, dithered shine, depth holes), side boughs. Blossoms in spring, fiery orange in autumn. |
| 10 | `pine` | Pine | forest | **Pro-art pass**: gradient trunk + 4 conical tiers, each tier lit on its upper-left edge and separated by an under-skirt shadow line. |
| 11 | `birch` | Birch | forest | **Pro-art pass**: white bark with black lenticel dashes, airy light-green canopy with shine dither. Spring blossoms, gold autumn. |
| 12 | `maple` | Maple | forest | **Pro-art pass**: broad two-sided crown spilling over a shaded trunk, dense 4-tone green shading. Crimson red in autumn. |
| 13 | `berry` | Berry Bush | forest | Rounded bush with scattered dark-red berry pixels. |
| 14 | `apple` | Apple Tree | forest | Rounded canopy dotted with red apple pixels. |
| 15 | `snowpine` | Snow Pine | snow | Conical tiers with white snow caps along each skirt + summit dot. |
| 16 | `spruce` | Spruce | snow | **Pro-art pass**: slim dark spruce, 4 tight tiers with lit edges and shadow lines under each skirt. |
| 17 | `dead` | Dead Tree | snow | Bare gnarled trunk with broken branch stubs, no foliage. |
| 18 | `frostbush` | Frost Bush | snow | Low bush with icy-white frosting on top. |
| 19 | `pebble` | Small Rock | all | Single grey stone lump with highlight. |
| 20 | `rock` | Medium Rock | all | Faceted grey boulder, darker base shade. |
| 21 | `boulder` | Big Rock | all | Large two-tone boulder with cracks and moss hints. |
| 22 | `greatbush` | Great Bush | forest | Big rounded shrub taller than a villager. |
| 23 | `bloom` | Blossom Bush | forest | Green mound covered in pink/white blossom specks. |
| 24 | `bramble` | Bramble Tangle | jungle | Chaotic thorny tangle with dark thorn ticks. |

## 2. Fish Atlas — `fishAtlasCanvas` (192×64)

- 6 species × 32px cells, two rows: row 0 tail-left, row 1 tail-right (swim animation).
- Painted by `paintFish(g, ox, oy, k, frameB)` directly into card thumbs / map chip too.

| Cell | Species | Body | Belly | Fin | Stripe |
|------|---------|------|-------|-----|--------|
| 0 | Sardine | silver-blue `#b8c4cc` | pale | grey | — |
| 1 | Clownfish | orange `#f4772e` | light orange | orange | white bands |
| 2 | Blue Tang | royal blue `#2e6fd4` | sky | yellow | navy |
| 3 | Angelfish | golden yellow | pale lemon | olive | dark vertical band |
| 4 | Puffer | sandy khaki | cream | brown | spikes when puffed |
| 5 | Tuna | steel blue | silver | slate | dark back stripe |

## 3. Map Icon Atlas — `iconAtlasCanvas`

One row of 40px cells mirroring KIND_ORDER plus special chips:

- Tree chips (per species): miniaturized summer art.
- Campfire chip (`FIRE_COL`): log teepee + flame overlay.
- Face chip (`FACE_COL`): villager head icon for people markers.
- Fish chip (`FISH_COL`, painted straight via `paintFish`, clownfish): school marker —
  one chip clusters many fish within a ~12u grid so the map isn't flooded.

## 4. Villagers

- Base rows in `CAVEMAN_ART` / `CAVEWOMAN_ART` char maps with palette lookup;
  per-villager variants restyle hair/beard/clothes (`artVariant`) using `LOOK_POOL`.
- Age stages scale height (child → adult → elder); three materials per villager:
  `[matR, matL, matSleep]`.
- **Sleep art**: eyes closed (`S` glyph with lash pixels below), baked −90° rotation into a
  lying pose canvas (`matSleep`) — head to the left, body along the ground.
- Name tag sprite above each head (canvas): name · age, **health bar** (green→red),
  **energy bar** (amber→red, blue + `zZ` while asleep).

## 5. Camp & effects

- `CAMPFIRE` char-map art: stone ring + crossed logs teepee; `FLAME` overlays animated fire.
- ZZZ stream: three rising "z" glyphs fading in loop above sleepers (`drawZzz`).
- Reaction bubbles: ascii `!`, `!!`, `?!`, `‼`, `✦` (+`✨` for the Water discovery).
- Lightning bolt polyline flash + expanding shockwave rings.

## 6. UI glyphs (DOM, not canvas)

👁 toggle UI · 🌍 regenerate · 🔄 auto-spin · 🗺️ top view · 🏠 home · ⬚ box-select ·
❚❚ pause · 👤 villager panel · » assets panel · 🫀 anatomy · 📖 knowledge book ·
🔒 locked knowledge nodes · ☀️/🍂/❄️/🌸 season pill · 🐟 sea-life tab

---

### Palette conventions

- Outline-free soft pixel style; 1px highlights top-left, 1px shade bottom-right.
- Greens ramp: `#123420 → #173d22 → #256b35 → #3f8a4c → #6fd074 → #8fe093`.
- Bark ramps: `#462c16 → #5a3a1e → #6b4526 → #8a5a33 → #96613a`.
- Helpers: `tpx` rect, `tblob` ellipse, `ttrunk` shaded bark, `tcanopy` volumetric foliage.
