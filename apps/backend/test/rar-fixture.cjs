// RAR 5 sem compressão para os testes de integração, conforme o formato oficial:
// https://www.rarlab.com/technote.htm
const { crc32 } = require('node:zlib');

function vint(value) {
  const bytes = [];
  do { bytes.push((value & 127) | (value > 127 ? 128 : 0)); value = Math.floor(value / 128); } while (value);
  return Buffer.from(bytes);
}
function uint32(value) { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; }
function header(parts) {
  const data = Buffer.concat(parts);
  const sized = Buffer.concat([vint(data.length), data]);
  return Buffer.concat([uint32(crc32(sized)), sized]);
}

exports.rar = function rar(entries) {
  const chunks = [Buffer.from('526172211a070100', 'hex'), header([vint(1), vint(0), vint(0)])];
  for (const [name, value] of entries) {
    const filename = Buffer.from(name);
    const data = Buffer.from(value);
    chunks.push(header([
      vint(2), vint(2), vint(data.length), vint(4), vint(data.length), vint(0),
      uint32(crc32(data)), vint(0), vint(0), vint(filename.length), filename,
    ]), data);
  }
  chunks.push(header([vint(5), vint(0), vint(0)]));
  return Buffer.concat(chunks);
};
