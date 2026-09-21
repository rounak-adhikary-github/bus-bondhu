/* Final smoke audit of the emitted dataset: counts + the routes the user
   reported as broken. Run with:  node tools/audit/final-check.js          */
const { loadData, resolve, findRoutes } = require("./load.js");

const d = loadData();
console.log("routes            :", d.routes.length);
console.log("routable stops    :", d.busStops.length);
console.log("plotted stops     :", Object.keys(d.stops).length);
console.log("aliases           :", Object.keys(d.aliases).length);
console.log("localities        :", Object.keys(d.areas).length);
console.log("");

const checks = [
  ["Sec V", "Thakurpukur"],
  ["Bekbagan", "Howrah Station"],
  ["Joka", "Esplanade"],
  ["Sishu Mangal", "Esplanade"],
  ["Kakdwip", "Kakdwip Bus Stand"],
  ["Salt Lake Sector V", "Joka"],
  ["Sec V", "Joka"],
];

for (const pair of checks) {
  const from = pair[0];
  const to = pair[1];
  const a = resolve(d, from);
  const b = resolve(d, to);
  const res = findRoutes(d, from, to);
  console.log(
    from + " -> " + to +
    "   [" + a + " => " + b + "]" +
    "   routes: " + res.rows.length
  );
}

console.log("");
const sample = ["sec v", "secv", "beck bagan", "sishu mangal", "bkp chiriamore", "p t s", "sdf more"];
for (const s of sample) {
  console.log('alias "' + s + '" => ' + (d.aliases[s] || "(none)"));
}
