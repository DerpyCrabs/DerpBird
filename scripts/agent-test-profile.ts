import { mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
/** Explicit test harness profile; production launch always uses the user's profile. */
export async function useTestProfile() {
  const profile = await mkdtemp(join(process.cwd(), 'artifacts/agent-test-profile-'));
  await mkdir(join(profile, 'data'));
  await mkdir(join(profile, 'config'));
  await Bun.write(join(profile, 'data/ImportWelcomeSeen'), '1');
  await Bun.write(join(profile, 'config/Settings.json'), JSON.stringify({ firstRunComplete: true, restorePreviousSession: false, backgroundNetworking: { enabled: false } }));
  process.env.DERPBIRD_PROFILE = profile;
  return profile;
}
