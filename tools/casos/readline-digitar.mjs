// digitar: Bia\n2
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
const rl = readline.createInterface({ input, output });
const nome = await rl.question("Nome? ");
const idade = await rl.question("Idade? ");
console.log(`Olá, ${nome}! ${idade}`);
rl.close();
