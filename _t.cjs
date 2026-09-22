// Herramienta temporal (se elimina al terminar).
//   node _t.cjs read  <file> [start] [end]
//   node _t.cjs write <target> <snippet> [start end | start insert | append | (vacío = archivo completo)]
const fs = require('fs');
const [, , mode, ...rest] = process.argv;
const A = (s) => s.replace(/\r\n/g, '\n');

if (mode === 'cat') {
  const [target, ...sources] = rest;
  const text = sources.map((p) => A(fs.readFileSync(p, 'utf8'))).join('\n').replace(/\n/g, '\r\n');
  fs.writeFileSync(target, text, 'utf8');
  console.log('OK ' + target + ' (' + text.length + ' chars)');
  process.exit(0);
}

if (mode === 'read') {
  const [file, s, e] = rest;
  const lines = A(fs.readFileSync(file, 'utf8')).split('\n');
  const start = s ? Number(s) : 1;
  const end = e ? Number(e) : Math.min(lines.length, start + 199);
  const out = [];
  for (let i = start; i <= Math.min(end, lines.length); i++) {
    out.push(String(i).padStart(4, ' ') + '| ' + lines[i - 1]);
  }
  console.log(out.join('\n'));
  process.exit(0);
}

const [target, snippet, s, e] = rest;
const raw = fs.readFileSync(target, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const hasBom = raw.charCodeAt(0) === 0xfeff;
const lines = A(raw).split('\n');
const newLines = A(fs.readFileSync(snippet, 'utf8')).split('\n');
while (newLines.length > 0 && newLines[newLines.length - 1] === '') newLines.pop();

let out;
if (!s) {
  out = newLines;
} else if (e === 'insert') {
  const start = Number(s);
  out = lines.slice(0, start - 1).concat(newLines, lines.slice(start - 1));
} else if (e === 'append') {
  const base = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
  out = base.concat(newLines);
} else {
  const start = Number(s);
  const end = e ? Number(e) : start;
  if (start < 1 || end > lines.length || end < start) {
    console.log('RANGO INVALIDO (total ' + lines.length + ')');
    process.exit(1);
  }
  out = lines.slice(0, start - 1).concat(newLines, lines.slice(end));
}

let text = out.join(eol);
if (hasBom && text.charCodeAt(0) !== 0xfeff) text = '\ufeff' + text;
fs.writeFileSync(target, text, 'utf8');
console.log('OK ' + target + ' (lineas ' + lines.length + ' -> ' + out.length + ')');
