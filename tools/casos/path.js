const path = require("path");
console.log(path.join("/home/ana", "docs", "../x.txt"), path.resolve("a/b"), path.basename("/a/b/c.txt"), path.basename("/a/b/c.txt", ".txt"), path.extname("x.tar.gz"), path.dirname("/a/b/c"), path.parse("/home/ana/x.txt"), path.relative("/a/b", "/a/c/d"), path.normalize("a//b/../c/"), path.sep, path.isAbsolute("x"));
console.log(__dirname, path.join(__dirname, "dados.txt"));
