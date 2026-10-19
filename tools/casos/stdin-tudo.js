// stdin: 3\n4
const t = require("fs").readFileSync(0, "utf8");
console.log(t.trim().split("\n").map(Number).reduce((a, b) => a + b));
