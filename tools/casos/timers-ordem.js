setTimeout(() => console.log("timeout"), 0);
setImmediate(() => console.log("immediate"));
process.nextTick(() => console.log("tick"));
Promise.resolve().then(() => console.log("promise"));
console.log("sync");
