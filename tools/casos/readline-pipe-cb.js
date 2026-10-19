// stdin: Ana\n30
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Nome? ", (nome) => {
  rl.question("Idade? ", (idade) => {
    console.log(`Olá, ${nome}! ${idade}`);
    rl.close();
  });
});
