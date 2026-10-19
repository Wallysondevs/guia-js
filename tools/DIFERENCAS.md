# Diferenças: editor do guia × Node.js do lab

O editor (`assets/jssim.js` + `assets/jssim/worker.js`) roda o JavaScript **do navegador do leitor**
num ambiente que imita o `node main.js` do **Node.js v24.22.0**. Este arquivo resume o que ainda sai
diferente do lab (`~/guia-js-lab/lab`). Mantido pelo agente do simulador.

- **Registro automático** de cada página testada com `--nativo`: `tools/DIFERENCAS-AUTO.md` (fora do git,
  reescrito a cada teste). Uma diferença que não está explicada aqui é um achado: avise o simulador.
- **Bateria de fidelidade**: `timeout 900 node tools/conferir-casos.js` roda os programas de
  `tools/casos/` no editor (Chromium headless) e no lab, e compara. Estado em 19/10/2026: 111 de 112 iguais.

## Diferenças conhecidas (esperadas)
| Assunto | Editor | Lab | Por quê |
|---|---|---|---|
| Mensagens de erro no **Firefox/Safari** | outro texto (`x is undefined`, `can't access property…`) | as do V8 | outro motor de JavaScript; a caixa avisa o leitor |
| Estouro de pilha (`Maximum call stack size exceeded`) | a coluna do `^` e dos `at f (…)` pode ser outra | a do V8 do Node 24 | o V8 do Chrome é mais novo que o do Node 24 (13.6) |
| `Math.random()`, `Date.now()`, `new Date()`, `console.time`, `performance.now()` | outros valores | outros valores | mudam a cada execução |
| Fuso horário | o do navegador do leitor | `America/Sao_Paulo` | o editor não muda o relógio do leitor; o **idioma** sim (pt-BR, como o lab: `toLocaleString`, `Intl`, o nome do fuso no `String(new Date())`) |
| `console.log(promessa)` | sabe o estado só das Promises criadas com `new Promise`, `Promise.resolve`, `Promise.reject`; as de `async function` saem `Promise { <pending> }` | `Promise { 1 }` se já resolvida | o navegador não deixa ler o estado de uma Promise |
| `fetch` | o do navegador (só sites com CORS) | sem internet no lab | |
| `os.cpus()`, memória, `uptime`, `process.pid`, `process.memoryUsage()` | valores fixos | os da máquina | |
| `throw "texto"` (não-Error): a linha do cabeçalho | a do 1º `throw` do arquivo | a do `throw` que rodou | o navegador não diz onde um valor que não é Error foi lançado |
| `Warning: Detected unsettled top-level await` | a linha do último `rl.question` pendente (ou do 1º `await`) | a do `await` pendente | idem |
| Módulos sem suporte (`http`, `child_process`, `net`, `worker_threads`, `zlib`, `stream` de verdade), `npm` | erro do editor dizendo que não tem o módulo | funcionam | o navegador não tem rede/processos/sistema de arquivos de verdade |
| `require()` de um módulo ES | erro do editor | funciona (Node 24) | |
| Módulos ES que se importam em círculo | erro do editor | funcionam | |
| `{` a mais/a menos num arquivo carregado com `require` (não no main.js) | mensagem pode diferir | `Unexpected end of input`/`Unexpected token '}'` | o editor embrulha o módulo numa função |
| `fs.readFileSync(0)` sem `data-stdin` | pede as linhas e o Ctrl+D e roda o programa de novo | lê o teclado até o Ctrl+D | o navegador não tem leitura bloqueante |
| `process.stdout.isTTY` | `true`, 80 colunas | `true` no terminal, `undefined` num pipe | o editor imita o terminal da Ana |
