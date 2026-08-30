const CONTROLLED_PILOT_PROFILE_SUFFIX = '-controlled-pilot'

export function hasControlledPilotProfileId(profileId: unknown): boolean {
  return typeof profileId === 'string' && profileId.endsWith(CONTROLLED_PILOT_PROFILE_SUFFIX)
}
