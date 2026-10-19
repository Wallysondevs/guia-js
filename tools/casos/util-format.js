const util = require("util");
console.log(util.format("%s tem %d anos e %i filhos, %f", "Ana", 30.5, 2.9, 1.5));
console.log("%o", {a: [1, {b: 2}]});
console.log("%j", {a: 1}, "extra", 5);
console.log("%c estilo", "color: red");
console.log(util.inspect({a: {b: {c: {d: {}}}}}, {depth: Infinity}));
console.log("%s", Symbol("s"), 10n, null, undefined, -0);
