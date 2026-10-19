import fs from "node:fs";
fs.writeFileSync("t.json", "{\n  \"a\": 1\n  \"b\": 2\n}");
function carregar() {
  return JSON.parse(fs.readFileSync("t.json", "utf8"));
}
const t = carregar();
