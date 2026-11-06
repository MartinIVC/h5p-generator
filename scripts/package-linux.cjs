'use strict';
// Distribución local sin ASAR: conserva las rutas de workers y módulos nativos.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
(async () => {
  const outputName = process.argv[2] || `h5p-generator-linux-${process.arch}`;
  if (!/^h5p-generator-linux-[a-z0-9-]+$/.test(outputName)) throw new Error('Nombre de distribución inválido.');
  if (process.platform !== 'linux') throw new Error('Este empaquetado solo está verificado para Linux.');
  const output = path.join(root, 'dist', outputName);
  await fs.rm(output, { recursive: true, force: true });
  await fs.cp(path.join(root, 'frontend/node_modules/electron/dist'), output, { recursive: true });
  await fs.rm(path.join(output, 'resources/default_app.asar'), { force: true });
  await fs.rename(path.join(output, 'electron'), path.join(output, 'h5p-generator'));
  const app = path.join(output, 'resources/app');
  await fs.mkdir(app, { recursive: true });
  const manifest = require('../frontend/package.json');
  await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ name: manifest.name, version: manifest.version, main: 'frontend/index.js' }, null, 2));
  // Lista explícita: nunca incluye .env, datos locales ni credenciales.
  for (const entry of ['index.js', 'index.html', 'preload.js', 'ipc', 'js', 'css', 'assets']) {
    await fs.cp(path.join(root, 'frontend', entry), path.join(app, 'frontend', entry), { recursive: true });
  }
  for (const entry of ['storage.js', 'chunker.js', 'llmClient.js', 'prompts.js', 'inspectionWorker.js', 'h5pPackageWorker.js', 'templates', 'package.json', 'package-lock.json']) {
    await fs.cp(path.join(root, 'backend', entry), path.join(app, 'backend', entry), { recursive: true });
  }
  execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: path.join(app, 'backend'), stdio: 'inherit' });
  console.log(`Paquete Linux: ${output}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
