# Contributing to Pixel World

First off — **fire good, contributions better**. 🔥 Thanks for helping the tribe.

## Getting set up

```bash
git clone https://github.com/FREECANDY-DEV/pixel-world.git
cd pixel-world
npm start          # http://localhost:8000
```

That's it. There are no dependencies to install and no build step — the game is
plain HTML/CSS/JS served statically.

## Ground rules

1. **Small PRs win.** One feature or one fix per pull request. If it grows,
   split it.
2. **All art stays procedural.** Sprites are painted at runtime with canvas
   `fillRect` calls (`tpx`, `tblob`, `ttrunk`, `tcanopy`, …). Please don't add
   binary image assets.
3. **Plain ES2020+.** No transpilers, no bundlers, no framework of the week.
4. **Match existing style.** Same naming, same section-banner comments, same
   tone (a little playful is fine).
5. **Test before you push.** See below.

## Testing your change

The game exposes a headless-friendly debug API on `window.__DBG`. A quick
smoke test with puppeteer-core:

```js
const puppeteer = require('puppeteer-core');
(async () => {
  const b = await puppeteer.launch({ executablePath: 'chromium', args: ['--no-sandbox'] });
  const p = await b.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e));
  await p.goto('http://localhost:8000', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__DBG && __DBG.version());
  await p.evaluate(() => { __DBG.strike(); __DBG.setHour(22); });
  console.log('know:', await p.evaluate(() => __DBG.know()));
  console.log('errors:', errors.length);
  await b.close();
})();
```

Include the commands you ran in your PR description.

### Handy debug hooks

| Hook | What it does |
|---|---|
| `__DBG.version()` | Current version string |
| `__DBG.cavemen()` | Villager roster |
| `__DBG.strike()` | Trigger campfire gathering |
| `__DBG.know()` / `__DBG.unlock(name)` | Read / force knowledge state |
| `__DBG.energy(i)` / `__DBG.sleepCount()` | Energy & sleep stats |
| `__DBG.setHour(h)` / `__DBG.day()` | Time control |
| `__DBG.tpVillager(i,x,z)` / `__DBG.setStick(x,z)` | Move / steer villagers |
| `__DBG.fishCount()` / `__DBG.fishState()` | Sea life |
| `__DBG.depthAt(x,z)` / `__DBG.findSea()` | Terrain queries |
| `__DBG.setIconMode(on)` | Icon LOD mode |

## Adding a new species (the fun part)

1. Find `TREE_KINDS` in `main.js` and add a painter entry keyed by your species name.
2. Use the shared helpers — `ttrunk` for shaded trunks, `tcanopy` for volumetric
   canopies, `tpx`/`tblob` for everything else.
3. Register the key in `KIND_ORDER` so it shows up in the Assets panel and map icons.
4. Seasonal variants are automatic; painters get the season row for free.
5. Update [`SPRITESHEET.md`](SPRITESHEET.md) so the catalog stays honest.

## Reporting bugs

Open an issue with:

- What you did and what you expected
- Console output (F12 → Console)
- Browser + OS

Screenshots or GIFs of weird villager behaviour are extremely welcome.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
