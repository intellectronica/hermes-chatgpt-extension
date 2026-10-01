import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import type { HermesConfig } from '../shared/types';
import { backendBaseUrl } from '../hermes/urls';

const nonempty = z.string().min(1).max(500).regex(/^[^\x00-\x1f\x7f]+$/, 'Control characters are not allowed');
const remotePath = nonempty.refine(value => value.startsWith('/') || value.startsWith('~/'), 'Use an absolute remote path or ~/ relative to the SSH user');
const configSchema = z.object({
  sidebar: z.object({ showAutomatedChats: z.boolean().optional() }).strict().optional(),
  connections: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    label: z.string().min(1).max(120),
    kind: z.enum(['http', 'ssh']),
    baseUrl: nonempty.optional(),
    tokenEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
    tokenFile: nonempty.optional(),
    cwd: nonempty.optional(),
    ssh: z.object({
      host: z.string().regex(/^(?!-)[a-zA-Z0-9_.:\[\]-]+$/).max(253),
      user: z.string().regex(/^(?!-)[a-zA-Z0-9_.-]+$/).max(80).optional(),
      port: z.number().int().min(1).max(65535).optional(),
      mode: z.enum(['attach', 'managed']).optional(),
      remoteHost: z.enum(['127.0.0.1', 'localhost', '[::1]']).optional(),
      remotePort: z.number().int().min(1).max(65535).optional(),
      hermesHome: remotePath.optional(),
      pythonPath: remotePath.optional(),
      repoPath: remotePath.optional(),
    }).strict().optional(),
  }).strict()).max(30),
}).strict().superRefine((config, context) => {
  const ids = new Set<string>();
  config.connections.forEach((connection, index) => {
    if (ids.has(connection.id)) context.addIssue({ code: 'custom', message: 'Connection IDs must be unique', path: ['connections', index, 'id'] });
    ids.add(connection.id);
    if (connection.kind === 'ssh' && !connection.ssh) context.addIssue({ code: 'custom', message: 'SSH connections need ssh settings', path: ['connections', index, 'ssh'] });
    if (connection.kind === 'http' && !connection.baseUrl) context.addIssue({ code: 'custom', message: 'HTTP connections need baseUrl', path: ['connections', index, 'baseUrl'] });
    if (connection.kind === 'http' && connection.ssh) context.addIssue({ code: 'custom', message: 'HTTP connections cannot include ssh settings', path: ['connections', index, 'ssh'] });
    if (connection.kind === 'ssh' && connection.baseUrl) context.addIssue({ code: 'custom', message: 'SSH connections use their forwarded listener, without baseUrl', path: ['connections', index, 'baseUrl'] });
    if (connection.baseUrl) {
      try { backendBaseUrl(connection.baseUrl); }
      catch (error) { context.addIssue({ code: 'custom', message: (error as Error).message, path: ['connections', index, 'baseUrl'] }); }
    }
    const managed = connection.kind === 'ssh' && connection.ssh?.mode !== 'attach';
    const credentials = [connection.tokenEnv, connection.tokenFile].filter(value => value !== undefined).length;
    if (managed && credentials) context.addIssue({ code: 'custom', message: 'Managed SSH creates its own process token; remove tokenEnv and tokenFile', path: ['connections', index] });
    if (!managed && credentials !== 1) context.addIssue({ code: 'custom', message: 'Attached backends need exactly one of tokenEnv or tokenFile', path: ['connections', index] });
    if (managed && (connection.ssh?.remoteHost !== undefined || connection.ssh?.remotePort !== undefined)) context.addIssue({ code: 'custom', message: 'remoteHost and remotePort apply only to SSH attach mode', path: ['connections', index, 'ssh'] });
    if (connection.kind === 'ssh' && connection.ssh?.mode === 'attach') {
      if (connection.ssh.remotePort === undefined) context.addIssue({ code: 'custom', message: 'SSH attach mode needs an explicit remotePort', path: ['connections', index, 'ssh', 'remotePort'] });
      if (connection.ssh.hermesHome !== undefined || connection.ssh.repoPath !== undefined || connection.ssh.pythonPath !== undefined) context.addIssue({ code: 'custom', message: 'hermesHome, repoPath and pythonPath apply only to managed SSH', path: ['connections', index, 'ssh'] });
    }
  });
});

export function parseConfig(input: unknown): HermesConfig {
  return configSchema.parse(input);
}

function localPath(value: string, directory = process.cwd()): string {
  if (value.startsWith('~/') || value === '~') return resolve(homedir(), value.slice(2));
  if (value.startsWith('~')) throw new Error('Use ~/ for the current user’s home directory.');
  return resolve(directory, value);
}

async function readConfig(file: string): Promise<HermesConfig> {
  const path = localPath(file);
  const config = parseConfig(JSON.parse(await readFile(path, 'utf8')));
  return { ...config, connections: config.connections.map(connection => ({
    ...connection, ...(connection.tokenFile ? { tokenFile: localPath(connection.tokenFile, dirname(path)) } : {}),
  })) };
}

/** Explicit paths fail closed; discovery never falls past a present but invalid file. */
export async function loadConfig(file?: string): Promise<HermesConfig> {
  try {
    const explicit = file ?? process.env.HERMES_EXTENSION_CONFIG;
    if (explicit !== undefined) {
      if (!explicit.trim()) throw new Error('An explicit configuration path cannot be empty.');
      return await readConfig(explicit);
    }
    const xdg = process.env.XDG_CONFIG_HOME;
    const userDirectory = xdg && isAbsolute(xdg) ? xdg : resolve(homedir(), '.config');
    for (const path of [...new Set([resolve('hermes.config.json'), resolve(userDirectory, 'hermes-chatgpt-extension', 'hermes.config.json')])]) {
      try { return await readConfig(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return { connections: [] };
  } catch (error) {
    if (error instanceof z.ZodError) throw new Error(`Invalid Hermes connection configuration: ${error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
    throw new Error('Cannot read Hermes connection configuration. Check the file path and JSON.');
  }
}
