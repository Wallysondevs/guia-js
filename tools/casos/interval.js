let n = 0;
const t = setInterval(() => { n++; console.log("tique", n); if (n === 3) clearInterval(t); }, 10);
