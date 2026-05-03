import { db } from '../db';

export default defineEventHandler(async () => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: 'unknown',
      xrpl: 'unknown',
    },
  };

  // Check database connection
  try {
    await db`SELECT 1`;
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

  return health;
});
