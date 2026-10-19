// digitar: Bia
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Nome? ", (n) => { console.log("oi", n); rl.question("Idade? ", (i) => console.log(i)); });
rl.on("close", () => console.log("fechou"));
