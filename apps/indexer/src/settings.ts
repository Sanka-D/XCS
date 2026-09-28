/**
 * Checked-in behavioural settings for the indexer worker.
 *
 * The deployment contract in `apps/indexer/.env.example` holds secrets and
 * values that genuinely differ per deployment. Everything else -- tuning values
 * and the registry/database posture -- lives here, in code, so a deployment
 * cannot change it by editing a variable in a secret store. Changing one of
 * these is a reviewed code change that ships with the image.
 *
 * The values are strings because they are fed through exactly the same parsing
 * and validation as before (see `config.ts`): `loadIndexerRuntimeConfig` and
 * friends still receive one environment-shaped record and still report the same
 * errors under the same names.
 */

/**
 * Settings the environment cannot override. These are behaviour, not deployment
 * inputs, and a deployment that wants different values changes them here.
 */
export const indexerSettings = {
  XCS_INDEXER_POLL_INTERVAL_MS: '4000',
  XCS_INDEXER_LEASE_DURATION_MS: '30000',
  XCS_INDEXER_BATCH_SIZE: '20',
} as const satisfies Record<string, string>

/**
 * Settings whose defaults live here but which the environment may still
 * override, and only these.
 *
 * ADR 0003 defines one non-normative deployment -- the disposable Commons
 * controlled Testnet pilot -- that runs against a registry whose master key may
 * still be enabled. It needs its own profile file, `controlled-testnet-pilot`
 * and `exclusive-profile`, and it is the only deployment that does. Pinning
 * those three in code would either make the pilot unexpressible or bake its
 * weaker posture into every image, so the exception stays an environment
 * override of a safe default instead.
 *
 * The defaults below are the safe ones: `blackholed` and `shared`. Overriding
 * them does not by itself relax anything -- `resolveRegistryPolicy` still
 * demands the exact `XCS_CONTROLLED_PILOT_ACK` value, network 1 and the exact
 * pilot profile ID, and `resolveDatabaseScope` still demands
 * `exclusive-profile`. `XCS_CONTROLLED_PILOT_ACK` deliberately has no default:
 * absent means not acknowledged, and only the environment can supply it.
 */
export const pilotOverridableSettings = {
  XCS_REGISTRY_POLICY: 'blackholed',
  XCS_DATABASE_SCOPE: 'shared',
} as const satisfies Record<string, string>

/**
 * The environment every production entry point parses: the process environment
 * with the checked-in settings applied. Blank environment values are ignored so
 * a Compose or platform default of `""` cannot defeat a safe default.
 */
export function indexerEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const overridable: NodeJS.ProcessEnv = { ...pilotOverridableSettings }
  for (const key of Object.keys(overridable)) {
    const supplied = environment[key]
    if (supplied !== undefined && supplied.trim().length > 0) overridable[key] = supplied
  }
  return { ...environment, ...overridable, ...indexerSettings }
}
