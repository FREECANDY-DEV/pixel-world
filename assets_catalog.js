// assets_catalog.js — Comprehensive 1,020 Asset Registry Generator
const fs = require('fs');

const categories = [
  { name: '👤 Tribe & Hero Classes', start: 1, end: 150, prefix: 'Hero' },
  { name: '🌲 Vegetation & Flora', start: 151, end: 300, prefix: 'Flora' },
  { name: '🐟 Sea Life & Aquatic Organisms', start: 301, end: 400, prefix: 'Fish' },
  { name: '🦣 Wildlife, Beasts & Megafauna', start: 401, end: 550, prefix: 'Beast' },
  { name: '🏚️ Base Building & Housing', start: 551, end: 700, prefix: 'Structure' },
  { name: '⚔️ Weapons & Armaments', start: 701, end: 800, prefix: 'Weapon' },
  { name: '🚗 Vehicles & Transports', start: 801, end: 900, prefix: 'Vehicle' },
  { name: '🦈 Marine Predators & Ocean', start: 901, end: 950, prefix: 'Predator' },
  { name: '🪵 World Resources & Props', start: 951, end: 1000, prefix: 'Resource' },
  { name: '👾 Era NPC Enemies', start: 1001, end: 1020, prefix: 'Enemy' }
];

const CORE_NAMED_ASSETS = {
  1: 'Hazmat Human', 2: 'Caveman', 3: 'Cavewoman', 4: 'Tribe Child', 5: 'Tribe Elder',
  6: 'Knight', 7: 'Cyborg', 8: 'Ninja', 9: 'Wizard', 10: 'Astronaut', 11: 'Pirate',
  
  151: 'Cactus', 152: 'Agave', 153: 'Acacia', 154: 'Desert Shrub', 155: 'Tumble Bush',
  156: 'Jungle Tree', 157: 'Palm', 158: 'Bamboo', 159: 'Fern Thicket', 160: 'Oak',
  161: 'Pine', 162: 'Birch', 163: 'Maple', 164: 'Berry Bush', 165: 'Apple Tree',
  166: 'Snow Pine', 167: 'Spruce', 168: 'Dead Tree', 169: 'Frost Bush', 170: 'Small Rock',
  171: 'Medium Rock', 172: 'Big Rock', 173: 'Great Bush', 174: 'Blossom Bush', 175: 'Bramble Tangle',
  
  301: 'Sardine', 302: 'Clownfish', 303: 'Blue Tang', 304: 'Angelfish', 305: 'Puffer', 306: 'Tuna',
  
  401: 'Mammoth', 402: 'Sabertooth', 403: 'Wild Boar', 404: 'Rabbit', 405: 'Eagle', 406: 'Honeybee',
  407: 'T-Rex', 408: 'Wolf', 409: 'Bear', 410: 'Snake', 411: 'Dragon', 412: 'Scorpion', 413: 'Fox', 414: 'Owl',
  
  551: 'Thatch Hut', 552: 'Log Cabin', 553: 'Stone Cottage', 554: 'Bunker', 555: 'Cyber Hab',
  556: 'Watchtower', 557: 'Pyramid', 558: 'Castle', 559: 'Windmill',
  
  701: 'Flint Spear', 702: 'Iron Sword', 703: 'Tactical Rifle', 704: 'Plasma Saber',
  705: 'Crossbow', 706: 'Grenade', 707: 'Laser Cannon', 708: 'Flamethrower', 709: 'Battleaxe',
  
  801: 'Chariot', 802: 'Survival Jeep', 803: 'Hovercraft', 804: 'Combat Mech',
  805: 'Canoe', 806: 'Spaceship', 807: 'Tank', 808: 'Submarine',
  
  901: 'Great White', 902: 'Octopus', 903: 'Sea Turtle', 904: 'Jellyfish', 905: 'Crab', 906: 'Stingray', 907: 'Squid',
  
  951: 'Wood Pile', 952: 'Red Poppy', 953: 'Sunflower', 954: 'Beehive', 955: 'Iron Ore',
  956: 'Gold Ore', 957: 'Diamond Ore', 958: 'Mushroom', 959: 'Chest', 960: 'Campfire',
  
  1001: 'Rival Hunter', 1002: 'Barbarian Raider', 1003: 'Renegade Knight', 1004: 'Rogue Soldier', 1005: 'Cyber Drone'
};

const VARIANT_SUFFIXES = [
  'Alpha', 'Prime', 'Mk-II', 'Elite', 'Ancient', 'Cyber', 'Starlight', 'Void',
  'Solar', 'Lunar', 'Shadow', 'Crimson', 'Emerald', 'Azure', 'Golden', 'Obsidian',
  'Rift', 'Quantum', 'Nebula', 'Overlord', 'Sentinel', 'Vanguard', 'Titan', 'Apex'
];

const catalog = [];
const seenIds = new Set();

for (let i = 1; i <= 1020; i++) {
  const idStr = '#' + String(i).padStart(4, '0');
  if (seenIds.has(idStr)) throw new Error(`Duplicate ID ${idStr}`);
  seenIds.add(idStr);

  const catObj = categories.find(c => i >= c.start && i <= c.end) || categories[0];
  const era = i <= 150 ? (1 + Math.floor((i - 1) / 30)) : Math.min(5, Math.ceil(i / 200));

  let name = CORE_NAMED_ASSETS[i];
  if (!name) {
    const baseName = CORE_NAMED_ASSETS[catObj.start + ((i - catObj.start) % 10)] || catObj.prefix;
    const suffix = VARIANT_SUFFIXES[(i * 7) % VARIANT_SUFFIXES.length];
    name = `${baseName} ${suffix}`;
  }

  catalog.push({
    id: idStr,
    num: i,
    name: name,
    category: catObj.name,
    era: era,
    rating: 9.5
  });
}

console.log(`Successfully generated ${catalog.length} unique assets!`);
fs.writeFileSync('C:/Users/emilt/OneDrive/Desktop/pixel world/catalog_data.json', JSON.stringify(catalog, null, 2));
