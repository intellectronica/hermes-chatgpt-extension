import { z } from 'zod';
import type { ActionName, HermesService, JsonValue } from '../shared/types';

const connectionId = z.string().min(1).max(80);
const profile = z.string().min(1).max(120);
const sessionId = z.string().min(1).max(200);
const owner = { connectionId, profile, sessionId };
const selection = { connectionId, profile };

export const actionSchemas = {
  list_connections: z.object({}).strict(),
  list_profiles: z.object({ connectionId }).strict(),
  list_sessions: z.object(selection).strict(),
  open_chat: z.object({ ...selection, sessionId: sessionId.optional() }).strict(),
  get_chat: z.object(owner).strict(),
  send_message: z.object({ ...owner, text: z.string().trim().min(1).max(50_000) }).strict(),
  interrupt_chat: z.object(owner).strict(),
  answer_question: z.object({ ...owner, questionId: z.string().min(1).max(200), response: z.json() }).strict(),
  list_cron_jobs: z.object(selection).strict(),
  get_cron_runs: z.object({ ...selection, jobId: z.string().min(1).max(200), limit: z.number().int().min(1).max(100).optional() }).strict(),
};

export class ActionError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}

export async function dispatchAction(service: HermesService, action: string, input: unknown): Promise<unknown> {
  if (!Object.hasOwn(actionSchemas, action)) throw new ActionError('unsupported_action', 'This action is not supported.');
  const name = action as ActionName;
  const result = actionSchemas[name].safeParse(input);
  if (!result.success) throw new ActionError('invalid_arguments', 'This action needs valid connection, profile and item details.');
  const args = result.data as Record<string, unknown>;
  if (args.profile === 'all' && name !== 'list_cron_jobs') throw new ActionError('invalid_profile', 'Select a specific profile for this action.');
  const ref = { connectionId: args.connectionId as string, profile: args.profile as string, sessionId: args.sessionId as string };
  switch (name) {
    case 'list_connections': return service.listConnections();
    case 'list_profiles': return service.listProfiles(ref.connectionId);
    case 'list_sessions': return service.listSessions(ref.connectionId, ref.profile);
    case 'open_chat': return service.openChat({ connectionId: ref.connectionId, profile: ref.profile, ...(args.sessionId ? { sessionId: ref.sessionId } : {}) });
    case 'get_chat': return service.getChat(ref);
    case 'send_message': return service.sendMessage(ref, args.text as string);
    case 'interrupt_chat': return service.interruptChat(ref);
    case 'answer_question': return service.answerQuestion(ref, args.questionId as string, args.response as JsonValue);
    case 'list_cron_jobs': return service.listCron(ref.connectionId, ref.profile);
    case 'get_cron_runs': return service.getCronRuns(ref.connectionId, ref.profile, args.jobId as string, args.limit as number | undefined);
  }
}

export function publicError(error: unknown): { code: string; message: string; status: number } {
  if (error instanceof ActionError) return { code: error.code, message: error.message, status: error.status };
  // Service errors contain operational explanations; never serialise raw objects or upstream bodies.
  const raw = error instanceof Error ? error.message : 'Hermes could not complete this action.';
  const message = raw
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/((?:token|password|secret|authorization)["']?\s*[:=]\s*)["']?[^\s,}"']+/gi, '$1[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[redacted]@')
    .slice(0, 500);
  return { code: 'hermes_error', message, status: 502 };
}

export function actionSummary(action: string, data: unknown): string {
  if (Array.isArray(data)) return `${action}: ${data.length} items. Open the Hermes app to see details.`;
  return `${action} completed. Details are available in the Hermes app.`;
}
