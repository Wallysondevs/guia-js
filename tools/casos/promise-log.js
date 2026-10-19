console.log(Promise.resolve(5), Promise.reject(new Error("x")).catch(() => {}), new Promise(() => {}));
const p = new Promise((ok) => ok(1)); console.log(p);
