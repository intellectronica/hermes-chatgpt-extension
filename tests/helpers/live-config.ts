import type { ConnectionConfig } from '../../src/shared/types';

/** Live tests require explicit target details; ordinary tests never use a real server. */
export function liveSshConfig(): NonNullable<ConnectionConfig['ssh']> & { hermesHome: string } {
  const required = (name: string): string => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Live tests require ${name}.`);
    return value;
  };
  return {
    mode: 'managed',
    host: required('HERMES_LIVE_SSH_HOST'),
    user: process.env.HERMES_LIVE_SSH_USER?.trim() || undefined,
    repoPath: required('HERMES_LIVE_REPO'),
    pythonPath: required('HERMES_LIVE_PYTHON'),
    hermesHome: required('HERMES_LIVE_HOME'),
  };
}
