import postgres from 'postgres';

export const db = postgres(
  process.env.DATABASE_URL ?? 'postgresql://user:12345678@localhost:5432/xcs'
);
