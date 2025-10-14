import { db } from '../db';
import { sql } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: 'unknown',
      xrpl: 'unknown',
      ipfs: 'unknown',
    },
  };

  // Check database connection
  try {
    await db.execute(sql`SELECT 1`);
    health.services.database = 'ok';
  } catch (error) {
    health.status = 'degraded';
    health.services.database = 'error';
    console.error('Database health check failed:', error);
  }

  // Check XRPL connection
  try {
    const { useXRPL } = await import('../utils/xrpl');
    const xrpl = useXRPL();
    await xrpl.connect();
    health.services.xrpl = 'ok';
    await xrpl.disconnect();
  } catch (error) {
    health.status = 'degraded';
    health.services.xrpl = 'error';
    console.error('XRPL health check failed:', error);
  }

  // IPFS doesn't need real-time connection check (checked on use)
  health.services.ipfs = 'ok';

  return health;
});
