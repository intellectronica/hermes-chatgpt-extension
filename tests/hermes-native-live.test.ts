import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createHermesService } from '../src/hermes/service.js';
import { liveSshConfig } from './helpers/live-config';

const execute = promisify(execFile);
const quote = (value: string): string => `'${value.replaceAll("'", "'\"'\"'")}'`;

async function configurationHashes(settings: ReturnType<typeof liveSshConfig>): Promise<string> {
  const home = settings.hermesHome;
  const destination = `${settings.user ? `${settings.user}@` : ''}${settings.host}`;
  // Hashes only: never return configuration or credential values to the test runner.
  const source = `from pathlib import Path\nimport hashlib,json\nhome=Path(${JSON.stringify(home)})\nroots=[home,*sorted((home/'profiles').iterdir())]\nfiles=[p/n for p in roots if p.is_dir() for n in ['config.yaml','profile.yaml','.env']]\nfiles.append(home/'active_profile')\nprint(json.dumps({str(p.relative_to(home)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file()},sort_keys=True))`;
  const result = await execute('ssh', ['-T', '-o', 'BatchMode=yes', destination, `python3 -c ${quote(source)}`], { timeout: 20_000, maxBuffer: 64_000 });
  const hashes = JSON.parse(result.stdout) as Record<string, string>;
  expect(Object.keys(hashes).length > 0).toBe(true);
  return JSON.stringify(hashes);
}

/** Explicit opt-in: empty test session settings only, no inference or cron execution. */
describe.skipIf(process.env.HERMES_NATIVE_LIVE_TEST !== '1')('live native Hermes controls', () => {
  it('reads actual avatars/catalogues and acknowledges session-only model/effort with saved configuration unchanged', async () => {
    const settings = liveSshConfig();
    const before = await configurationHashes(settings);
    const service = createHermesService({ connections: [{
      id: 'native-ssh', label: 'Native contract verification', kind: 'ssh', ssh: settings,
    }] });
    try {
      const profiles = await service.listProfiles('native-ssh');
      expect(profiles.some(profile => profile.name === 'default')).toBe(true);
      const catalogueCounts: Record<string, number> = {};
      for (const profile of profiles) {
        const catalogue = await service.listModels('native-ssh', profile.name);
        catalogueCounts[profile.name] = catalogue.models.length;
        expect(catalogue.models.some(model => model.id === catalogue.defaultModelId)).toBe(true);
        expect(catalogue.defaultReasoningEffort).toBe(profile.reasoningEffort);
        expect(new Set(catalogue.models.map(model => model.id)).size).toBe(catalogue.models.length);
      }
      const avatarHashes = Object.fromEntries(profiles.filter(profile => profile.avatar).map(profile => [profile.name, createHash('sha256').update(Buffer.from(profile.avatar!.split(',')[1]!, 'base64')).digest('hex')]));
      const defaults = await service.listModels('native-ssh', 'default');
      const initial = await service.openChat({ connectionId: 'native-ssh', profile: 'default' });
      const ref = { connectionId: 'native-ssh', profile: 'default', sessionId: initial.id };
      expect(initial.modelId).toBe(defaults.defaultModelId);
      expect(initial.reasoningEffort).toBe(defaults.defaultReasoningEffort);
      const initialModel = defaults.models.find(model => model.id === defaults.defaultModelId)!;
      const candidates = defaults.models.filter(model => model.id !== defaults.defaultModelId && model.reasoningSupported !== false && model.provider === initialModel.provider).slice(0, 3);
      expect(candidates.length > 0).toBe(true);
      let changed = false;
      let guardedChoices = 0;
      for (const candidate of candidates) {
        const result = await service.configureChat(ref, { modelId: candidate.id, reasoningEffort: 'low' });
        if (result.confirmation) { guardedChoices += 1; continue; }
        expect(result.chat.model).toBe(candidate.model);
        expect(result.chat.modelId).toBe(candidate.id);
        expect(result.chat.reasoningEffort).toBe('low');
        changed = true;
        break;
      }
      expect(changed).toBe(true);
      const reasoned = await service.configureChat(ref, { reasoningEffort: 'high' });
      expect(reasoned.chat.reasoningEffort).toBe('high');
      await vi.waitFor(async () => expect((await service.getChat(ref)).reasoningEffort).toBe('high'), { timeout: 5_000 });
      const afterProfiles = await service.listProfiles('native-ssh');
      expect(afterProfiles.map(profile => [profile.name, profile.model, profile.provider, profile.reasoningEffort])).toEqual(profiles.map(profile => [profile.name, profile.model, profile.provider, profile.reasoningEffort]));
      expect((await service.getChat(ref)).messages).toEqual([]);
      console.log(JSON.stringify({ profiles: profiles.length, avatars: Object.keys(avatarHashes).length, avatarHashes, catalogueCounts, defaultsPresent: true, modelChanged: changed, effortReadBack: 'high', guardedChoices, inference: false, cronTriggered: false }));
    } finally {
      await service.dispose();
      expect(await configurationHashes(settings) === before).toBe(true);
    }
  }, 180_000);
});
