import type { VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'nextjs',
  // Same region as the Upstash Redis database (sub50-rooms), so every room
  // read/commit is an in-region round trip.
  regions: ['iad1'],
};
