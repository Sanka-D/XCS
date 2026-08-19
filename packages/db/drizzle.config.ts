import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.XCS_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgresql://xcs:xcs@localhost:5432/xcs',
  },
  strict: true,
  verbose: true,
})
