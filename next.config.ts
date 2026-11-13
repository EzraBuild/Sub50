import { networkInterfaces } from 'node:os';
import type { NextConfig } from 'next';

/** This machine's LAN IPv4 addresses: phones on the same Wi-Fi load the dev server through these. */
const lanHosts = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i!.address);

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Next blocks dev-only resources (HMR, chunks) for origins other than localhost.
  allowedDevOrigins: lanHosts,
  turbopack: { root: process.cwd() },
};

export default config;
