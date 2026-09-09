import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1E232F" />
      <stop offset="100%" stop-color="#0B0D12" />
    </linearGradient>
    <linearGradient id="markGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00F2FE" />
      <stop offset="35%" stop-color="#4FACFE" />
      <stop offset="100%" stop-color="#FFFFFF" />
    </linearGradient>
    <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="rgba(79, 172, 254, 0.4)" />
      <stop offset="100%" stop-color="rgba(255, 255, 255, 0.05)" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="12" flood-color="#00F2FE" flood-opacity="0.25" />
    </filter>
  </defs>
  <!-- Background Squircle -->
  <rect x="20" y="20" width="472" height="472" rx="112" fill="url(#bgGrad)" stroke="url(#borderGrad)" stroke-width="8" />
  
  <!-- CapCut Official Logo Mark -->
  <g transform="translate(116, 116) scale(11.57)" filter="url(#glow)">
    <path d="M24.189 6.442V2.671l-4.535 2.383V4.91c.002-1.505-1.078-2.411-2.638-2.411H2.64C.993 2.5 0 3.407 0 4.91V8.72L6.354 12 0 15.316v3.8C0 20.595 1 21.5 2.64 21.5h14.373c1.56 0 2.639-.907 2.639-2.382v-.197l4.536 2.409v-3.828L13.64 12 24.19 6.443zM9.982 13.873l7.797 4.083H2.157l7.825-4.083zm7.741-7.828l-7.742 4.057-7.825-4.057h15.567z" fill="url(#markGrad)" />
  </g>
</svg>`;

async function main() {
  const publicDir = path.resolve('public');
  const buildDir = path.resolve('build');
  fs.mkdirSync(publicDir, { recursive: true });
  fs.mkdirSync(buildDir, { recursive: true });

  const svgPath = path.join(publicDir, 'capcut-icon.svg');
  fs.writeFileSync(svgPath, svgContent);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;background:transparent;overflow:hidden;">${svgContent}</body></html>`);

  const sizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = [];

  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    const buffer = await page.locator('svg').screenshot({
      type: 'png',
      omitBackground: true,
    });
    pngBuffers.push({ size, data: buffer });
    if (size === 256) {
      fs.writeFileSync(path.join(publicDir, 'icon.png'), buffer);
      fs.writeFileSync(path.join(buildDir, 'icon-preview.png'), buffer);
      fs.writeFileSync(path.join(buildDir, 'icon.png'), buffer);
    }
  }

  await browser.close();

  // Create ICO file
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(pngBuffers.length, 4);

  let offset = 6 + pngBuffers.length * 16;
  const entries = [];
  for (const { size, data } of pngBuffers) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bit depth
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }

  const icoBuffer = Buffer.concat([header, ...entries, ...pngBuffers.map((p) => p.data)]);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), icoBuffer);

  console.log('Successfully generated CapCut icons in public/ and build/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
