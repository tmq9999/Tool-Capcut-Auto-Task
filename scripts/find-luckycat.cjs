const fs = require('fs');
const readline = require('readline');
const rs = fs.createReadStream('Capture/Capture_Full_Capcut_Flow');
const rl = readline.createInterface({ input: rs });
const paths = new Set();
rl.on('line', line => {
  const matches = line.match(/\/[a-zA-Z0-9_\/]*task\/[a-zA-Z0-9_\/]+/g);
  if (matches) {
    for (const m of matches) paths.add(m);
  }
});
rl.on('close', () => console.log('Unique /task/ paths in capture:\n', Array.from(paths).sort().join('\n')));
