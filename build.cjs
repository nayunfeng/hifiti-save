const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
fs.mkdirSync(path.join(root, 'dist'), {recursive: true});
fs.writeFileSync(path.join(root, 'dist/hifiti-save.user.js'), read('src/header.txt') + '\n(() => {\n"use strict";\n' + read('src/core.js') + '\n' + read('src/app.js') + '\n})();\n');
console.log('Built dist/hifiti-save.user.js');
