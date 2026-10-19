# Estado do editor do Guia JavaScript (o simulador)

Mantido pelo agente do simulador. O contrato das caixas está no `CONTRIBUINDO.md` (§3 e §4);
aqui ficam a arquitetura, as ferramentas e o que falta.

## Arquivos
| Arquivo | O que é |
|---|---|
| `assets/jssim.js` | Funções puras (metas, `data-*`, argumentos; também `require`-áveis no Node), o motor de execução (`JsSim.rodarMotor`: um Web Worker novo por Rodar, limite de 10 s sem contar a espera do teclado, `lerTudo` com nova execução) e a interface da caixa `.tryjs` (editor com abas, terminal, campo de entrada, Parar/Ctrl+C/Ctrl+D, missões). Carrega o `jssim/web.js` se houver `.tryweb`. |
| `assets/jssim/worker.js` | O "node": imita o `node main.js` do Node.js v24.22.0 com o JavaScript do navegador. CommonJS (embrulho de função carregado com `importScripts` de um blob, `this` = `module.exports`) e módulos ES (blobs com os `import` reescritos), a detecção do Node 24, `process`, `console` (com o `util.inspect` do Node), `fs` em memória, `path`, `readline` (com o comportamento de pipe × terminal do Node), `events`, `util`, `os`, `assert`, timers (Timeout/Immediate com os nomes do Node nos frames), erros não tratados no formato do Node (pilha via `Error.prepareStackTrace` + as linhas `node:internal` do Node 24.22), REPL. |
| `assets/jssim/inspect.js` | `util.inspect`/`util.format` do Node, extraídos (`node-inspect-extracted` 3.3.4, MIT), com o estado das Promises vindo do worker. |
| `assets/jssim/web.js` | A caixa `.tryweb`: `index.html` num `iframe` srcdoc da mesma origem, as outras abas como blobs (`charset=utf-8`), um `<script>` do editor antes de tudo liga o console (texto no jeito do Chrome), os erros, `prompt/alert/confirm` (no testador) e as mudanças (para conferir a missão a cada clique/tecla). `JsSim.testarWeb` para o testador. |
| `assets/site.js` (trecho) / `assets/style.css` (fim) | O desenho do `pre.devtools` (janela Console do Chrome). |

## Ferramentas (na VPS, com `timeout`)
| Comando | Para quê |
|---|---|
| `node tools/sim.js main.js […] [--stdin T \| --digitar T] [--args A] [--goal M] [--repl] [--json]` | roda um programa no editor (Chromium headless) e mostra o terminal da caixa |
| `node tools/testar-missoes.js [--nativo] [-q] pagina.html… \| --todas` | o testador dos autores (`~/guia-js-lab/testar` no notebook chama este) |
| `node tools/testar-navegador.js [-q] [--fotos DIR] pagina.html… \| --todas` | a página inteira no Chromium, clicando em Rodar como o leitor |
| `node tools/conferir-casos.js [filtro] [-v]` | a bateria de fidelidade: `tools/casos/*` no editor × no Node do lab |
| `tools/motor-navegador.js` | o Chromium + servidor local usados pelas três ferramentas acima |
| `tools/lab-nativo.js` | roda no `~/guia-js-lab/lab` (pipe, ou terminal de verdade com `-t` + `tela` quando há `data-digitar`) |

Registro automático das diferenças: `tools/DIFERENCAS-AUTO.md` (fora do git). Resumo das conhecidas: `tools/DIFERENCAS.md`.

## Estado (19/10/2026)
- Bateria `conferir-casos`: 124 de 125 iguais ao Node do lab (a diferença: a coluna do estouro de pilha, V8 mais novo).
- `testar-navegador --todas`: 159 páginas, 0 com problema.
- `testar-missoes --todas --nativo`: veja `/tmp/jsnat-todas.txt` e `tools/DIFERENCAS-AUTO.md` na VPS.

## O que falta / ideias
- Estado das Promises de `async function` no `console.log` (o navegador não deixa ler).
- `require()` de módulo ES e módulos ES que se importam em círculo.
- `stream` de verdade, `node:test`, `node:http` (fora do escopo do editor).
- A linha exata do `throw "texto"` e do aviso de top-level await pendente (heurísticas).
- Firefox/Safari: a pilha é refeita a partir do texto (`f@url:l:c`), sem os nomes do V8; as mensagens de erro são as do motor deles.
