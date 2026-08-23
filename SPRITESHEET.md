# 🎨 Pixel World — Spritesheet Reference

> Every sprite in Pixel World is **painted by code** at runtime — no image files are loaded.
> The pixel art lives in painter functions inside `main.js`, and each sprite below is a
> **live capture** of what those painters produce. This doc catalogs every sprite, where it
> lives in the code, and what it looks like.

![Vegetation atlas](docs/assets/spritesheet/tree-atlas.png)
![Fish atlas](docs/assets/spritesheet/fish-atlas.png)
![Icon atlas](docs/assets/spritesheet/icon-atlas.png)

---

## 1. Vegetation Atlas — `treeAtlasCanvas`

The heart of the plant world: **25 species**, one 48×48 cell per species.

- Cell size: **48×48 px**, one column per species (`ATLAS_CELL`), ground line ≈ y 46.
- **4 season rows** per column: spring (row 0), summer (row 1), autumn (row 2), winter (row 3).
- Autumn/winter rows are derived from the painted summer base by `deriveSeasons()`
  (hue-shift to the species' autumn color, snow tinting, leaf-drop).
- Uploaded once as `treeAtlasTex` (NearestFilter, SRGB) and sampled by the wind-shader.
- Zoomed-out map markers are **1:1 copies** of the summer row — same art, bigger life.

| Art | Key | Label | Biome | Description |
|-----|-----|-------|-------|-------------|
| ![cactus](docs/assets/spritesheet/species-cactus.png) | `cactus` | Cactus | desert | Green saguaro column with lighter highlight edge, dark ribs, two side arms, spine dots. |
| ![agave](docs/assets/spritesheet/species-agave.png) | `agave` | Agave | desert | Rosette of stiff pointed leaves fanning from a dry centre, blue-green tones. |
| ![acacia](docs/assets/spritesheet/species-acacia.png) | `acacia` | Acacia | desert | Tall slim dark trunk, flat wide umbrella canopy, dusty olive greens; turns ochre in autumn. |
| ![shrub](docs/assets/spritesheet/species-shrub.png) | `shrub` | Desert Shrub | desert | Low scrubby ball of twiggy grey-green stems. |
| ![tumble](docs/assets/spritesheet/species-tumble.png) | `tumble` | Tumble Bush | desert | Round skeletal tumbleweed, tan criss-cross branches. |
| ![jungle](docs/assets/spritesheet/species-jungle.png) | `jungle` | Jungle Tree | jungle | Massive broadleaf: thick trunk, huge layered canopy blobs, deep greens. |
| ![palm](docs/assets/spritesheet/species-palm.png) | `palm` | Palm | jungle | Curved ringed trunk leaning with the wind, 7 arcing fronds, coconut cluster at the crown. |
| ![bamboo](docs/assets/spritesheet/species-bamboo.png) | `bamboo` | Bamboo | jungle | Cluster of segmented yellow-green culms with leaf tufts; autumn golds. |
| ![fern](docs/assets/spritesheet/species-fern.png) | `fern` | Fern Thicket | jungle | Low spread of arching fronds. |
| ![oak](docs/assets/spritesheet/species-oak.png) | `oak` | Oak | forest | **Pro-art pass**: shaded bark trunk (lit left edge, knots, root flare) + volumetric canopy (AO under-mass, lit upper-left cap, dithered shine, depth holes), side boughs. Blossoms in spring, fiery orange in autumn. |
| ![pine](docs/assets/spritesheet/species-pine.png) | `pine` | Pine | forest | **Pro-art pass**: gradient trunk + 4 conical tiers, each tier lit on its upper-left edge and separated by an under-skirt shadow line. |
| ![birch](docs/assets/spritesheet/species-birch.png) | `birch` | Birch | forest | **Pro-art pass**: white bark with black lenticel dashes, airy light-green canopy with shine dither. Spring blossoms, gold autumn. |
| ![maple](docs/assets/spritesheet/species-maple.png) | `maple` | Maple | forest | **Pro-art pass**: broad two-sided crown spilling over a shaded trunk, dense 4-tone green shading. Crimson red in autumn. |
| ![berry](docs/assets/spritesheet/species-berry.png) | `berry` | Berry Bush | forest | Rounded bush with scattered dark-red berry pixels. |
| ![apple](docs/assets/spritesheet/species-apple.png) | `apple` | Apple Tree | forest | Rounded canopy dotted with red apple pixels. |
| ![snowpine](docs/assets/spritesheet/species-snowpine.png) | `snowpine` | Snow Pine | snow | Conical tiers with white snow caps along each skirt + summit dot. |
| ![spruce](docs/assets/spritesheet/species-spruce.png) | `spruce` | Spruce | snow | **Pro-art pass**: slim dark spruce, 4 tight tiers with lit edges and shadow lines under each skirt. |
| ![dead](docs/assets/spritesheet/species-dead.png) | `dead` | Dead Tree | snow | Bare gnarled trunk with broken branch stubs, no foliage. |
| ![frostbush](docs/assets/spritesheet/species-frostbush.png) | `frostbush` | Frost Bush | snow | Low bush with icy-white frosting on top. |
| ![pebble](docs/assets/spritesheet/species-pebble.png) | `pebble` | Small Rock | all | Single grey stone lump with highlight. |
| ![rock](docs/assets/spritesheet/species-rock.png) | `rock` | Medium Rock | all | Faceted grey boulder, darker base shade. |
| ![boulder](docs/assets/spritesheet/species-boulder.png) | `boulder` | Big Rock | all | Large two-tone boulder with cracks and moss hints. |
| ![greatbush](docs/assets/spritesheet/species-greatbush.png) | `greatbush` | Great Bush | forest | Big rounded shrub taller than a villager. |
| ![bloom](docs/assets/spritesheet/species-bloom.png) | `bloom` | Blossom Bush | forest | Green mound covered in pink/white blossom specks. |
| ![bramble](docs/assets/spritesheet/species-bramble.png) | `bramble` | Bramble Tangle | jungle | Chaotic thorny tangle with dark thorn ticks. |

---

## 2. Fish Atlas — `fishAtlasCanvas` (192×64)

The sea's cast of six, each 32×32 px with a two-frame swim cycle.

- 6 species × 32px cells, two rows: row 0 tail-left, row 1 tail-right (swim animation).
- Painted by `paintFish(g, ox, oy, k, frameB)` directly into card thumbs / map chips too.
- **Sparse & deep**: schools are rare (one per ~7.5-unit cell, ~45% of cells) and
  cruise fully submerged (1.8–4+ blocks below the surface, never scraping the seabed),
  so the sea reads as occasional passing shoals — not a constant rain of pixels.
- `DoubleSide` billboards so they're visible from above *and* below the surface.
- **Distance-culled**: schools farther than 320 units from the camera aren't drawn.

| Art | Cell | Species | Body | Belly | Fin | Stripe |
|-----|------|---------|------|-------|-----|--------|
| ![sardine](docs/assets/spritesheet/fish-sardine.png) | 0 | Sardine | silver-blue `#b8c4cc` | pale | grey | — |
| ![clownfish](docs/assets/spritesheet/fish-clownfish.png) | 1 | Clownfish | orange `#f4772e` | light orange | orange | white bands |
| ![blue tang](docs/assets/spritesheet/fish-blue-tang.png) | 2 | Blue Tang | royal blue `#2e6fd4` | sky | yellow | navy |
| ![angelfish](docs/assets/spritesheet/fish-angelfish.png) | 3 | Angelfish | golden yellow | pale lemon | olive | dark vertical band |
| ![puffer](docs/assets/spritesheet/fish-puffer.png) | 4 | Puffer | sandy khaki | cream | brown | spikes when puffed |
| ![tuna](docs/assets/spritesheet/fish-tuna.png) | 5 | Tuna | steel blue | silver | slate | dark back stripe |

---

## 3. Map Icon Atlas — `iconAtlasCanvas`

One row of **48px cells** mirroring `KIND_ORDER` plus special chips. Tree/bush/rock
chips are **1:1 copies of the summer vegetation row** (`ICON_CELL = ATLAS_CELL`),
so zoomed-out markers show the exact same art as the in-world trees — just fewer
and bigger (each marker represents a whole grove).

- Tree chips (per species): **1:1 copy of the tree's exact current season art** —
  the same two atlas rows the wind-shader blends, mixed with the same weight, so
  a zoomed-out marker shows the tree exactly as it looks in-world (spring
  blossoms, autumn gold, winter snow included). The icon atlas rebuilds whenever
  the season changes. One representative marker per ~64u area.
- Campfire chip (`FIRE_COL`): log teepee + flame overlay.
- Face chip (`FACE_COL`): villager head icon for people markers.
- Fish chips (`FISH_COL + i`, one per species, painted straight via `paintFish`):
  the sea floor is flood-filled into connected **water bodies** (deep water, 3+
  blocks) and ONE marker is emitted per (body, species) — a whole ocean shows at
  most six spots, one per fish type, instead of a scatter of clones.

![Icon atlas](docs/assets/spritesheet/icon-atlas.png)

---

## 4. Villagers

![Villager face](docs/assets/spritesheet/face.png)

- Base rows in `CAVEMAN_ART` / `CAVEWOMAN_ART` char maps with palette lookup;
  per-villager variants restyle hair/beard/clothes (`artVariant`) using `LOOK_POOL`.
- Age stages scale height (child → adult → elder); three materials per villager:
  `[matR, matL, matSleep]`.
- **Sleep art**: eyes closed (`S` glyph with lash pixels below), baked −90° rotation into a
  lying pose canvas (`matSleep`) — head to the left, body along the ground.
- **The founding couple spawns asleep** by the campfire and only wakes when you strike
  the first campfire (`tribeAwoken`).
- Name tag sprite above each head (canvas): name · age, **health bar** (green→red),
  **energy bar** (amber→red, blue + `zZ` while asleep).

---

## 5. Camp & effects

![Campfire](docs/assets/spritesheet/campfire.png)

- `CAMPFIRE` char-map art: stone ring + crossed logs teepee; `FLAME` overlays animated fire.
- ZZZ stream: three rising "z" glyphs fading in loop above sleepers (`drawZzz`).
- Reaction bubbles: ascii `!`, `!!`, `?!`, `‼`, `✦` (+`✨` for the Water discovery).
- Lightning bolt polyline flash + expanding shockwave rings.
- **Camp label sprite** above the camp (`campLabelCanvas`, 256×72): a little
  pixel house with a stepped roof and door, outlined `CAMP` text, and a
  pixel-person icon carrying the live villager count.
- **Space dressing**: a hand-pixelled moon skin (`makeMoonTexture`, 64×32) —
  pale regolith with speckle and rimmed craters — plus a radial-glow sun sprite
  that dresses the planet view.

---

## 6. Anatomy view — `ANAT_ART` + `BODY_MAP`

The 🫀 anatomy sheet's organ sprites, painted from char maps via `anatSprite`:

| Art | Sprite | What it looks like |
|-----|--------|--------------------|
| ![heart](docs/assets/spritesheet/organs-heart.png) | `heart` | red valved heart, pale top-left highlight |
| ![brain](docs/assets/spritesheet/organs-brain.png) | `brain` | pink convoluted lobes, dark outline |
| ![lungs](docs/assets/spritesheet/organs-lungs.png) | `lungs` | two grey-pink lobes flanking a trachea |
| ![stomach](docs/assets/spritesheet/organs-stomach.png) | `stomach` | orange J-pouch with darker edge |
| ![liver](docs/assets/spritesheet/organs-liver.png) | `liver` | dark maroon slab, lighter top edge |
| ![guts](docs/assets/spritesheet/organs-guts.png) | `guts` | coiled pink intestines, outlined |
| ![skull](docs/assets/spritesheet/organs-skull.png) | `skull` | white cranium, dark eye sockets, teeth row |
| ![spine](docs/assets/spritesheet/organs-spine.png) | `spine` | vertebrae column with a rib fan |
| ![pelvis](docs/assets/spritesheet/organs-pelvis.png) | `pelvis` | butterfly-shaped hip bones |
| ![armbone](docs/assets/spritesheet/organs-armbone.png) | `armbone` | long bone with knuckle joints at both ends |
| ![legbone](docs/assets/spritesheet/organs-legbone.png) | `legbone` | long bone with knuckle joints at both ends |

- `BODY_MAP`: a 26×46 silhouette of a ~7.5-heads-tall figure (crown → feet) with
  regions keyed `h` head · `n`/`t` torso · `a`/`b` arms · `l`/`r` legs;
  `BODY_BOXES` derives per-part bounds so `partIconURL()` crops each body part
  into a 4×-scaled icon for the part list.
- Wound chips are small DOM pills (bleeding / scratched / bruised / fractured /
  damaged) layered on each part row.

---

## 7. UI glyphs (DOM, not canvas)

👁 toggle UI · 🌍 regenerate · 🔄 auto-spin · 🗺️ top view · 🏠 home · ⬚ box-select ·
❚❚ pause · 👤 villager panel · » assets panel · 🫀 anatomy · 📖 knowledge book ·
🔒 locked knowledge nodes · ☀️/🍂/❄️/🌸 season pill · 🐟 sea-life tab

### Sky pill icon — `celestial-icon` (48×48 canvas)

`drawCelestialIcon` paints the live sky in the season pill: a warm sun disc with
8 rotating rays (dusk-shifted colour), four twinkling stars, and a moon that
fades in as night falls.

---

### Palette conventions

- Outline-free soft pixel style; 1px highlights top-left, 1px shade bottom-right.
- Greens ramp: `#123420 → #173d22 → #256b35 → #3f8a4c → #6fd074 → #8fe093`.
- Bark ramps: `#462c16 → #5a3a1e → #6b4526 → #8a5a33 → #96613a`.
- Helpers: `tpx` rect, `tblob` ellipse, `ttrunk` shaded bark, `tcanopy` volumetric foliage.
