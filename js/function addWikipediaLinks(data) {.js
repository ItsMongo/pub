function addWikipediaLinks(data) {
  data.forEach(item => {
    const query = encodeURIComponent(`${item.make} ${item.model}`);
    item.tabs.history.wikipedia = `https://en.wikipedia.org/wiki/Special:Search?search=${query}`;
  });
}
function addGunDigestLinks(data) {
  data.forEach(item => {
    const query = encodeURIComponent(`${item.make} ${item.model} Gun Digest`);
    item.tabs.history.gunDigest = `https://gundigest.com/?s=${query}`;
  });
}
function validateHistoryFields(data) {
  const issues = [];

  data.forEach((item, index) => {
    const h = item.tabs?.history;

    if (!h) {
      issues.push({ index, error: "Missing tabs.history object" });
      return;
    }

    if (typeof h.wikipedia !== "string") {
      issues.push({ index, error: "Missing or invalid wikipedia field" });
    }

    if (typeof h.gunDigest !== "string") {
      issues.push({ index, error: "Missing or invalid gunDigest field" });
    }
  });

  return issues;
}
const res = await fetch("data/firearms.json");
firearms = await res.json();
addWikipediaLinks(firearms);
addGunDigestLinks(firearms);
const problems = validateHistoryFields(firearms);
console.log("Validation:", problems);
console.log(JSON.stringify(firearms, null, 2));