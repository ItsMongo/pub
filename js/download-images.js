

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");


// 🔥 Your firearm → image URL mapS
const firearms = {
    "Lee-Enfield No. 4 Mk I (F)": "© Armémuseum (The Swedish Army Museum) — CC BY-SA 4.0 — via Wikipedia",
    "Ruger 10/22": "© Dictouray at English Wikipedia — CC BY-SA 3.0 — via Wikimedia Commons",
    "Steyr Modelo 1912 Mauser": "© 10. Armeekommando — Public domain — via Wikimedia Commons",
    "Mauser Karabiner 98k": "© Armémuseum (The Swedish Army Museum) — CC BY-SA 3.0 — via Wikipedia",
    "Arisaka Type 99": "© The original uploader was BenDibble at English Wikipedia. — CC BY-SA 3.0 — via Wikimedia Commons",
    "Norinco SKS": "© Armémuseum (The Swedish Army Museum) — CC BY-SA 4.0 — via Wikipedia",
    "Springfield M1903A3": "© Armémuseum (The Swedish Army Museum) through the Digital Museum (http://www.digitaltmuseum.se). — CC BY-SA 3.0 — via Wikipedia",
    "Mosin-Nagant M91/30": "© Armémuseum (The Swedish Army Museum) — CC0 — via Wikipedia",
    "Savage Axis": "No image found",
    "Dutch Beaumont M.1896": "No image found",
    "Windham Weaponry AR-15": "No image found",
    "Enfield No.5 Mk I 'Jungle Carbine'": "© Armémuseum (The Swedish Army Museum) — CC BY-SA 4.0 — via Wikipedia",
    "MAS-49/56": "© Atirador — CC BY-SA 3.0 — via Wikimedia Commons",
    "MAS-49/56 (7.5 French)": "No image found",
    "Palmetto State Armory AR-10": "No image found",
    "Gewehr 43 (G43)": "© Armémuseum (The Swedish Army Museum) — CC BY-SA 4.0 — via Wikipedia",
    "Springfield M1A": "© U.S. Marine Corps photo illustration by Sgt. James Stanfield — Public domain — via Wikipedia",
    "SVT-40": "© digitaltmuseum.se — CC BY-SA 3.0 — via Wikipedia",
    "FN-49": "© The Smithsonian Institution — Public domain — via Wikimedia Commons",
    "Hakim Rifle": "© Nemo5576 — CC BY-SA 3.0 — via Wikimedia Commons",
    "Swedish Mauser M1896": "© Armémuseum (The Swedish Army Museum) — Public domain — via Wikipedia",
    "Winchester Model 70 XTR": "No image found",
    "M1 Garand (1941)": "© Armémuseum (The Swedish Army Museum) — CC BY-SA 4.0 — via Wikipedia",
    "M1 Garand (1955)": "© Armémuseum (The Swedish Army Museum) — CC BY-SA 4.0 — via Wikipedia",
    "M1 Carbine (1944)": "© Armémuseum (The Swedish Army Museum) — CC BY-SA 4.0 — via Wikipedia",
    "Remington Model 700": "© User:M855GT — CC BY-SA 3.0 — via Wikipedia",
    "Remington Model 1100": "© The Smithsonian Institution — Public domain — via Wikimedia Commons",
    "Beretta 686 Onyx": "No image found",
    "Remington Model 10": "© The Smithsonian Institution — Public domain — via Wikimedia Commons",
    "CVA Wolf .50 Cal Muzzleloader": "No image found"
};

// sanitize folder/file names
function safeName(name) {
  return name.replace(/[<>:"/\\|?*]+/g, "").replace(/\s+/g, "_");
}

// 🔥 smart download function
function download(url, filepath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;

    const request = client.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    }, (response) => {

      // 🔁 Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return download(response.headers.location, filepath)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode !== 200) {
        return reject(`Failed (${response.statusCode}): ${url}`);
      }

      const file = fs.createWriteStream(filepath);
      response.pipe(file);

      file.on("finish", () => {
        file.close(resolve);
      });
    });

    request.on("error", (err) => {
      fs.unlink(filepath, () => reject(err.message));
    });
  });
}

// main
async function run() {
  const baseDir = path.join(__dirname, "images");

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir);
  }

  for (const [name, url] of Object.entries(firearms)) {
    const folder = path.join(baseDir, safeName(name));

    // 🔥 better extension detection
    let ext = path.extname(new URL(url).pathname);
    if (!ext) ext = ".jpg";

    const filePath = path.join(folder, "primary" + ext);

    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder);
    }

    if (fs.existsSync(filePath)) {
      console.log("Skipping (exists):", name);
      continue;
    }

    try {
      console.log("Downloading:", name);
      await download(url, filePath);
      console.log("Saved:", filePath);
    } catch (err) {
      console.error("Error:", name, err);
    }
  }

  console.log("Done.");
}

run();