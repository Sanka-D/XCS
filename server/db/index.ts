import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const config = useRuntimeConfig();

const client = postgres(config.databaseUrl);

export const db = drizzle(client, { schema });
