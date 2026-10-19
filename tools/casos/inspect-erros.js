const e = new TypeError("ruim");
e.codigo = 42;
console.log({ erro: e.message, nome: e.name });
try { null.x; } catch (err) { console.log(err.message); console.log(String(err)); console.log(err instanceof TypeError); }
const e2 = new Error("com causa", { cause: new Error("raiz") });
console.log(e2.cause.message);
console.log([new Error("dentro").message]);
