// Waits for the Vite dev server, then prints the URL a phone on the same Wi-Fi should open.
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';

const PORT = Number(process.env.CLIENT_PORT ?? 5173);
const VIRTUAL = /(vethernet|wsl|hyper-v|virtualbox|vmware|vbox|docker|br-|veth|utun|tailscale|zerotier|loopback|bluetooth)/i;

function lanAddresses() {
  const out = [];
  for (const [name, infos] of Object.entries(networkInterfaces())) {
    for (const i of infos ?? []) {
      if (i.family !== 'IPv4' || i.internal || i.address.startsWith('169.254.')) continue;
      let score = i.address.startsWith('192.168.') ? 30 : i.address.startsWith('10.') ? 20 : 10;
      if (/(wi-?fi|wlan|wireless|en0|eth)/i.test(name)) score += 5;
      if (VIRTUAL.test(name)) score -= 50;
      out.push({ name, address: i.address, score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

const isUp = () =>
  new Promise((resolve) => {
    const s = connect({ port: PORT, host: '127.0.0.1' }, () => {
      s.end();
      resolve(true);
    });
    s.on('error', () => resolve(false));
  });

for (let i = 0; i < 120 && !(await isUp()); i++) await new Promise((r) => setTimeout(r, 250));
await new Promise((r) => setTimeout(r, 400)); // let Vite finish printing its own banner

const ips = lanAddresses();
const best = ips[0];
const g = (s) => `\x1b[32m${s}\x1b[0m`;
const b = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

console.log('');
console.log(b('  ◉ Sub50 is live'));
console.log(`  Desktop:  ${g(`http://localhost:${PORT}`)}`);
if (best) {
  console.log(`  Phone:    ${b(g(`http://${best.address}:${PORT}`))}  ${dim(`(${best.name})`)}`);
  for (const other of ips.slice(1)) console.log(dim(`            http://${other.address}:${PORT}  (${other.name})`));
  console.log('');
  console.log(await QRCode.toString(`http://${best.address}:${PORT}`, { type: 'terminal', small: true }));
  console.log(dim('  Phone must be on the same Wi-Fi. On Windows, allow Node.js through the firewall'));
  console.log(dim('  (Private networks) the first time, or the phone will just time out.'));
} else {
  console.log('  No LAN IPv4 address found. Are you connected to Wi-Fi/Ethernet?');
}
console.log('');
