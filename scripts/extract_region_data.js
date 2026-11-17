/**
 * data.js (classic script, ANKARA_DATA veya ISTANBUL_DATA) dosyasını
 * JSON olarak stdout'a yazar. migrate_all_regions.py bunu çağırır.
 */
const fs = require("fs");
const vm = require("vm");

const input = process.argv[2];
if (!input) {
  console.error("usage: node extract_region_data.js <data.js>");
  process.exit(1);
}

const code =
  fs.readFileSync(input, "utf8") +
  "\n;this.__OUT = (typeof ANKARA_DATA !== 'undefined' ? ANKARA_DATA : (typeof ISTANBUL_DATA !== 'undefined' ? ISTANBUL_DATA : null));";

const sandbox = {};
vm.runInNewContext(code, sandbox, { filename: input });
if (!sandbox.__OUT) {
  console.error("Veri nesnesi bulunamadı: " + input);
  process.exit(1);
}
process.stdout.write(JSON.stringify(sandbox.__OUT));
