class Pessoa { constructor(nome) { this.nome = nome; this.amigos = []; } falar() {} get maiusculo() { return this.nome.toUpperCase(); } }
console.log(new Pessoa("Ana"));
class Aluno extends Pessoa { #nota = 10; static escola = "X"; }
console.log(new Aluno("Bia"), Aluno, Pessoa);
const o = Object.create(null); o.a = 1; console.log(o);
console.log({ get x() { return 1; }, set y(v) {}, get z() { return 1; }, set z(v) {} });
const c = { a: 1 }; c.self = c; console.log(c);
console.log(new Date(0), [new Date(86400000)]);
console.log(/abc/gi, new RegExp("a/b"), new Error("falhou").message);
console.log({ f() {}, g: function () {}, h: () => {} });
console.log(Object.assign(() => {}, { extra: 1 }));
console.log(new Number(5), new String("abc"), new Boolean(false));
console.log([1, 2, 3].map(String), Object.entries({ a: 1, b: 2 }));
console.log(new Uint8Array([1, 2, 3]), new ArrayBuffer(4), new WeakMap(), new WeakSet());
console.log(JSON.stringify({ a: [1, 2], b: "x" }, null, 2));
console.log(process.argv.length, typeof globalThis, typeof window, typeof document, typeof self);
console.log(Object.groupBy([1, 2, 3, 4], (n) => (n % 2 ? "impar" : "par")));
console.log(new Set([1, 2]).union(new Set([3])), [3, 1, 2].toSorted());
