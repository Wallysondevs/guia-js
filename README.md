# Guia JavaScript

Site: https://wallysondevs.github.io/guia-js/

Curso de JavaScript moderno (até o ECMAScript 2025) em português, do zero ao avançado, feito para quem **nunca programou**. Funciona como uma escola: uma aula para cada assunto, organizadas em **3 níveis + projetos + referência** (165 páginas). Vai de `console.log`, variáveis, `if`, `for` e funções até arrays, objetos, classes, `async`/`await`, o DOM e eventos.

Nos níveis 1 e 2, os programas rodam no terminal com o **Node.js 24 LTS** (`node main.js`): um arquivo, um comando, a saída no terminal. As aulas do navegador (DOM, eventos, `localStorage`) usam uma página de verdade. Cada aula explica o código parte por parte (anatomia), mostra a saída real, o que acontece quando dá errado (com a mensagem verdadeira) e exercícios no fim. As saídas e mensagens de erro foram conferidas no **Node.js v24.22.0**.

Para praticar, as páginas trazem dois tipos de editor **Experimente** que rodam no seu navegador:

- **Programa** (`.tryjs`): imita o `node main.js`. Edite, clique em **Rodar** e veja a saída, os erros e o código de saída. O programa pode pedir uma entrada e você digita ali mesmo.
- **Página** (`.tryweb`): HTML + CSS + JS num quadro "Resultado", com um Console embaixo.

Nas **missões**, a caixa confere se você chegou ao resultado pedido. As duas caixas usam `assets/jssim.js`, que roda o JavaScript **do próprio navegador** num Web Worker (`assets/jssim/worker.js`) imitando o Node.js v24.22.0. A página não trava, e o botão **Parar** (ou o limite de 10 segundos) encerra um laço infinito. O editor é comparado automaticamente com o Node.js real (veja **Testes**).

Site 100% estático (HTML + CSS + JS, sem build e sem dependências externas): funciona no GitHub Pages. Para usar o editor no seu computador, sirva a raiz do site com um servidor local em vez de abrir o arquivo direto.

## Estrutura

```
index.html                 página inicial
<tema>.html                uma aula por tema
assets/style.css           visual
assets/site.js             níveis/menu (lista NIVEIS), Anterior/Próximo, anatomia, exercícios, console do navegador
assets/jssim.js            o editor "Experimente" (caixas .tryjs e .tryweb)
assets/jssim/worker.js     o "node" do editor: imita o node main.js
assets/jssim/inspect.js    o util.inspect do Node, para o console.log sair igual
assets/jssim/web.js        a caixa .tryweb (página + Console)
tools/sim.js               roda um programa como o editor rodaria
tools/testar-missoes.js    testa as missões de cada página
tools/testar-navegador.js  abre as páginas num Chromium sem janela e usa o editor como o leitor
tools/conferir-casos.js    bateria de fidelidade: editor × Node.js real
tools/casos/               os programas da bateria de fidelidade
tools/motor-navegador.js   roda o editor num Chromium sem janela (usado por sim.js e testar-missoes.js)
tools/lab-nativo.js        roda no Node.js do laboratório (usado pelo --nativo)
tools/DIFERENCAS.md        o que ainda sai diferente entre o editor e o Node.js
.github/workflows/pages.yml  publica o site no GitHub Pages a cada push na main
CONTRIBUINDO.md            como escrever uma aula
.nojekyll                  faz o GitHub Pages servir os arquivos como estão
```

## Testes

As ferramentas rodam o editor num Chromium sem janela (precisam do `puppeteer-core`).

```bash
node tools/testar-missoes.js --todas         # todas as páginas
node tools/testar-missoes.js pagina.html     # só estas páginas (-q mostra só os problemas)
node tools/testar-missoes.js --nativo pagina.html   # compara também com o Node.js real (precisa do laboratório)
node tools/conferir-casos.js                 # bateria de fidelidade (precisa do laboratório)
node tools/testar-navegador.js --todas       # abre todas as páginas como o leitor
node tools/sim.js main.js                    # roda um programa como o editor
bash tools/checar-privacidade.sh             # páginas e histórico; lista extra: PROIBIDO=lista.txt
```

## Publicar no GitHub Pages

O repositório já traz o workflow `.github/workflows/pages.yml`, que publica o site a cada push na branch `main`. Em **Settings → Pages**, escolha **Source → GitHub Actions**. Se preferir sem workflow, use **Deploy from a branch → main / (root)**.

## Adicionar uma aula

Leia `CONTRIBUINDO.md` e inclua a página na lista `NIVEIS` de `assets/site.js`.
