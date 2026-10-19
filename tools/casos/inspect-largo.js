const turma = [
  { nome: "Ana", notas: [9, 8.5, 10], aprovado: true },
  { nome: "Bia", notas: [7, 6, 8], aprovado: true },
  { nome: "Caio", notas: [4, 5, 3], aprovado: false },
];
console.log(turma);
console.log({ turma, total: turma.length, media: 7.3 });
const estoque = { arroz: { preco: 25.9, qtd: 10 }, feijao: { preco: 8.5, qtd: 0 }, cafe: { preco: 19.99, qtd: 3 } };
console.log(estoque);
console.log(Object.keys(estoque), Object.values(estoque));
console.log("x".repeat(100));
console.log(["x".repeat(30), "y".repeat(30), "z".repeat(30)]);
console.log(new Map(Object.entries(estoque)));
console.log([1.5, -2, 3e10, 0.000001, 123456789012345680000]);
