const { soma } = require("./contas.js");
console.log(soma(2, 3));
const c = require("./contas");
console.log(c === require("./contas.js"));
