const f = async () => { throw new TypeError("z"); };
await f();
