import { networkInterfaces } from 'node:os';

/** Virtual adapters that are almost never what a phone on the same Wi-Fi can reach. */
const VIRTUAL_ADAPTER = /(vethernet|wsl|hyper-v|virtualbox|vmware|vbox|docker|br-|veth|utun|tailscale|zerotier|loopback|bluetooth)/i;

function score(name: string, address: string): number {
  let s = 0;
  if (address.startsWith('192.168.')) s += 30;
  else if (address.startsWith('10.')) s += 20;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) s += 10;
  if (/(wi-?fi|wlan|wireless|en0|eth|ethernet)/i.test(name)) s += 5;
  if (VIRTUAL_ADAPTER.test(name)) s -= 50;
  return s;
}

/** Non-internal IPv4 addresses, best LAN candidate first. */
export function getLanAddresses(): string[] {
  const found: { address: string; score: number }[] = [];
  for (const [name, infos] of Object.entries(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (info.address.startsWith('169.254.')) continue; // link-local, no DHCP
      found.push({ address: info.address, score: score(name, info.address) });
    }
  }
  return found.sort((a, b) => b.score - a.score).map((f) => f.address);
}
