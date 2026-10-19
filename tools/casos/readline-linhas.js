// stdin: a\nb
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (l) => console.log("linha:", l));
rl.on("close", () => console.log("fim"));
