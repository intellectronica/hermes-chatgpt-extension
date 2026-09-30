import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { HermesConfig } from '../shared/types';

const nonempty = z.string().min(1).max(500);
const configSchema = z.object({
  connections: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    label: z.string().min(1).max(120),
    kind: z.enum(['http', 'ssh']),
    baseUrl: z.string().url().optional(),
    tokenEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
    tokenFile: nonempty.optional(),
    cwd: nonempty.optional(),
    ssh: z.object({
      host: z.string().regex(/^[a-zA-Z0-9_.:-]+$/).max(253),
      user: z.string().regex(/^[a-zA-Z0-9_.-]+$/).max(80).optional(),
      port: z.number().int().min(1).max(65535).optional(),
      mode: z.enum(['attach', 'managed']).optional(),
      remoteHost: z.enum(['127.0.0.1', 'localhost', '[::1]']).optional(),
      remotePort: z.number().int().min(1).max(65535).optional(),
      hermesHome: nonempty.optional(),
      pythonPath: nonempty.optional(),
      repoPath: nonempty.optional(),
      rendezvousDir: nonempty.optional(),
    }).strict().optional(),
  }).strict()).max(30),
}).strict().superRefine((config, context) => {
  const ids = new Set<string>();
  config.connections.forEach((connection, index) => {
    if (ids.has(connection.id)) context.addIssue({ code: 'custom', message: 'Connection IDs must be unique', path: ['connections', index, 'id'] });
    ids.add(connection.id);
    if (connection.kind === 'ssh' && !connection.ssh) context.addIssue({ code: 'custom', message: 'SSH connections need ssh settings', path: ['connections', index, 'ssh'] });
    if (connection.kind === 'http' && !connection.baseUrl) context.addIssue({ code: 'custom', message: 'HTTP connections need baseUrl', path: ['connections', index, 'baseUrl'] });
    if (connection.baseUrl) {
      const url = new URL(connection.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) context.addIssue({ code: 'custom', message: 'baseUrl must be HTTP(S), without credentials, query or fragment', path: ['connections', index, 'baseUrl'] });
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.protocol === 'http:' && !local) context.addIssue({ code: 'custom', message: 'Remote HTTP connections require HTTPS or SSH', path: ['connections', index, 'baseUrl'] });
    }
  });
});

export function parseConfig(input: unknown): HermesConfig {
  return configSchema.parse(input);
}

export async function loadConfig(file = process.env.HERMES_EXTENSION_CONFIG ?? 'hermes.config.json'): Promise<HermesConfig> {
  try {
    return parseConfig(JSON.parse(await readFile(resolve(file), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && file === 'hermes.config.json') return { connections: [] };
    if (error instanceof z.ZodError) throw new Error(`Invalid Hermes connection configuration: ${error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
    throw new Error('Cannot read Hermes connection configuration. Check the file path and JSON.');
  }
}
