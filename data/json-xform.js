// === Paste your firearm lines into this array ===
const lines = [
  "Rifle, Enfield, No 4 Mk 19/48, .303 British, Bolt",
  "Rifle, Ruger, 10/22, .22LR, Semi",
  "Rifle, Steyer, Modelo 1912 Mauser, NATO .308 Win, Bolt, Note: Argentine",
  "Rifle, Mauser, K98 (1937), 8mm Mauser, Bolt",
  "Rifle, Arisaka, Type 99, 7.7x58 Arisaka, Bolt",
  "Rifle, Norinco, SKS, 7.62x39, Semi",
  "Rifle, Springfield Armory, M1903A3, .30-06 Winchester, Bolt",
  "Rifle, Savage Arms, Axis, .308 Win, Bolt",
  "Rifle, Russian, Mosin Nagant M91/30 (1928), 7.62x54R, Bolt",
  "Rifle, Dutch Beaumont, m.1896, 11mm, Bolt",
  "Rifle, Windham Weaponry, AR-15, .223 Remington, Semi",
  "Rifle, Enfield, Jungle Carbine, .303 British, Bolt, Note: Sporterized",
  "Rifle, MAS, M49/56, NATO .308Win, Semi, Note: Caliber conversion by CCA importer",
  "Rifle, MAS M49/56, 7.5 French, Semi",
  "Rifle, Palmetto, AR-10, .308 Win, Semi, Note: Custom build",
  "Rifle, German, G43 (1944), 8mm Mauser, Semi, Note: ACC//44",
  "Rifle, Springfield Armory, M1A, .308 Win, Semi, Note: Wood and synthetic stocks",
  "Rifle, Russian, SVT-40, 7.62x54R ,Semi, Note: Finnish Capture",
  "Rifle, Fabrique Nationale, FN49, .30-06 Winchester, Semi, Note: Luxembourg contract",
  "Rifle, Egyptian, Hakim, 8mm Mauser, Semi",
  "Rifle, MAS, M1936, 7.5 French, Bolt",
  "Rifle, Marlin, M1895 (1972), .30-30 Win, Lever, Optic: Vortex, Crossfire, 3-7x40",
  "Rifle, Marlin, M1895 (1999), .450 Marlin, Lever, Optic: Leupold, Flex, 4x20",
  "Rifle, Marlin, M1895, .35 Remington, Optic: Bushnell, 3x9",
  "Rifle, Winchester, Model 70 XTR, .308 Win, Bolt, Optic: T/C, 3-9x40, Note: Short-action\\\\ featherweight",
  "Rifle, Springfield Armory, M1 Garand (1955), .30-06 Winchester, Semi",
  "Rifle, Springfield Armory, M1 Garand (1941), .30-06 Winchester, Semi",
  "Rifle, IBM, M1 Carbine (1944), .30 Carbine, Semi, Note: Paratrooper stock",
  "Rifle, Remington, Model 700, .223 Rem, Bolt, Optic: Sightron 3-9x40, Note: Mike's",
  "Rifle, Savage, Axis, .308 Win, Bolt, Note: Heavy Barrel; Compensator; bi-pod; Mike's",
  "Shotgun, Remington, M1100, 12 Ga, Semi, Note: Trap & Slug barrels. Lightweight Camo Turkey Stock",
  "Shotgun, Remington, M1100, 12 Ga, Semi, Note: Adjustable choke; hi-gloss wood Stock",
  "Shotgun, Beretta, M686, 12 ga., Over\\\\Under, Note: Onyx Pro",
  "Shotgun, Remington, Model 10, 12 ga, Pump",
  "Muzzleloader, Wolf, TBD, .50 Sabot, Optic: T/C 3-9x32, Note: Black powder"
];

// === Country inference map ===
const countryMap = {
  "Enfield": "United Kingdom",
  "Ruger": "USA",
  "Steyer": "Austria",
  "Mauser": "Germany",
  "Arisaka": "Japan",
  "Norinco": "China",
  "Springfield Armory": "USA",
  "Savage Arms": "USA",
  "Savage": "USA",
  "Russian": "Russia",
  "Dutch Beaumont": "Netherlands",
  "Windham Weaponry": "USA",
  "MAS": "France",
  "Palmetto": "USA",
  "German": "Germany",
  "Fabrique Nationale": "Belgium",
  "Egyptian": "Egypt",
  "Marlin": "USA",
  "Winchester": "USA",
  "IBM": "USA",
  "Remington": "USA",
  "Beretta": "Italy",
  "Wolf": "USA"
};

// === Helper: extract year from "(YYYY)" ===
function extractYear(model) {
  const match = model.match(/\((\d{4})\)/);
  return match ? parseInt(match[1], 10) : null;
}

// === Main parser ===
function parseLine(line) {
  let parts = line.split(",").map(s => s.trim());

  // Detect Optic and Note
  let optic = "";
  let note = "";

  const opticIndex = parts.findIndex(p => p.startsWith("Optic:"));
  if (opticIndex !== -1) {
    optic = parts[opticIndex].replace("Optic:", "").trim();
    parts.splice(opticIndex, 1);
  }

  const noteIndex = parts.findIndex(p => p.startsWith("Note:"));
  if (noteIndex !== -1) {
    note = parts[noteIndex].replace("Note:", "").trim();
    parts.splice(noteIndex, 1);
  }

  // Basic fields
  const type = parts[0];
  const make = parts[1];
  const model = parts[2];
  const caliber = parts[3];
  const action = parts[4] || "";

  const year = extractYear(model);

  const country = countryMap[make] || "";
  const flag = country ? `flags/${country}.png` : "";

  return {
    type,
    make,
    model,
    year,
    caliber,
    action,
    country,
    flag,
    optic,
    note,
    tabs: {
      history: { title: "", content: "" },
      purchase: "",
      marketValue: "",
      loadData: "",
      rangeNotes: "",
      maintenance: ""
    },
    images: []
  };
}

// === Convert all lines ===
const result = lines.map(parseLine);

// === Output JSON ===
console.log(JSON.stringify(result, null, 2));