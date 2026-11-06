'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
(async () => {
  const outputName = process.argv[2] || `h5p-generator-linux-${process.arch}`;
  if (!/^h5p-generator-linux-[a-z0-9-]+$/.test(outputName)) throw new Error('Nombre de distribución inválido.');
  const source = path.resolve(__dirname, '../dist', outputName);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-packaged-'));
  try {
    const target = path.join(temporary, 'application');
    await fs.cp(source, target, { recursive: true });
    const app = path.join(target, 'resources/app');
    const manifest = JSON.parse(await fs.readFile(path.join(app, 'package.json')));
    manifest.main = 'packaged-smoke.cjs';
    await fs.writeFile(path.join(app, 'package.json'), JSON.stringify(manifest));
    await fs.copyFile(path.join(__dirname, 'packaged-smoke.cjs'), path.join(app, manifest.main));
    const code = await new Promise((resolve, reject) => {
      const env = { ...process.env, H5P_TEST_DIRECTORY: temporary };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(path.join(target, 'h5p-generator'), [], { env, stdio: 'inherit' });
      const timeout = setTimeout(() => { child.kill('SIGKILL'); }, 120000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); resolve(code); });
    });
    if (code !== 0) throw new Error('Falló la integración empaquetada.');
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
