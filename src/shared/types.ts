/** Public UI contract. Credentials and raw configuration never belong here. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ConnectionSummary {
  id: string;
  label: string;
  kind: 'http' | 'ssh';
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: string;
}

export interface Profile {
  name: string;
  label?: string;
  model?: string;
  provider?: string;
  reasoningEffort?: string;
  /** Validated, bounded image data URI, fetched through the server-side Hermes adapter. */
  avatar?: string;
  isDefault?: boolean;
}

export interface ModelOption {
  /** Opaque identifier for the exact provider/model pair. */
  id: string;
  model: string;
  label: string;
  provider: string;
  providerLabel?: string;
  reasoningSupported?: boolean;
  canDisableReasoning?: boolean;
}

export interface ModelCatalogue {
  connectionId: string;
  profile: string;
  models: ModelOption[];
  defaultModelId: string;
  defaultReasoningEffort?: string;
  /** Hermes's supported effort dial; provider routing may clamp a level internally. */
  reasoningEfforts: string[];
}

export interface ChatConfiguration {
  modelId?: string;
  reasoningEffort?: string;
  /** Only sent after the user confirms Hermes's own guarded model selection. */
  confirm?: boolean;
}

export interface ChatRef {
  connectionId: string;
  profile: string;
  /** Durable Hermes stored session ID, never the runtime connection ID. */
  sessionId: string;
}

export interface OpenChatArgs {
  connectionId: string;
  profile: string;
  sessionId?: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  profile: string;
  updatedAt?: string;
  source?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  createdAt?: string;
  name?: string;
}

export interface ToolActivity {
  id: string;
  name: string;
  input?: string;
  output?: string;
  state: 'running' | 'completed' | 'error';
}

export interface Question {
  id: string;
  kind: 'approval' | 'clarify' | 'secret' | 'sudo';
  title: string;
  prompt: string;
  options?: { value: string; label: string }[];
}

export interface ChatSnapshot {
  connectionId: string;
  profile: string;
  id: string;
  runtimeId?: string;
  status: 'idle' | 'streaming' | 'unknown' | 'interrupted' | 'connecting';
  messages: ChatMessage[];
  tools: ToolActivity[];
  questions: Question[];
  cursor: number;
  epoch?: string;
  model?: string;
  modelId?: string;
  provider?: string;
  reasoningEffort?: string;
  error?: string;
}

export interface ChatConfigurationResult {
  chat: ChatSnapshot;
  confirmation?: {
    title: string;
    message: string;
    modelId: string;
    reasoningEffort?: string;
  };
}

export interface CronJob {
  id: string;
  profile: string;
  name: string;
  schedule: string;
  enabled: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: string;
  lastError?: string;
  timezone?: string;
  deliveryStatus?: string;
}

export interface CronRun {
  id: string;
  profile: string;
  jobId: string;
  title: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  output?: string;
  deliveryStatus?: string;
}

export interface HermesService {
  listConnections(): Promise<ConnectionSummary[]>;
  listProfiles(connectionId: string): Promise<Profile[]>;
  listSessions(connectionId: string, profile: string): Promise<SessionSummary[]>;
  listModels(connectionId: string, profile: string): Promise<ModelCatalogue>;
  openChat(args: OpenChatArgs): Promise<ChatSnapshot>;
  configureChat(ref: ChatRef, configuration: ChatConfiguration): Promise<ChatConfigurationResult>;
  getChat(ref: ChatRef): Promise<ChatSnapshot>;
  sendMessage(ref: ChatRef, text: string): Promise<ChatSnapshot>;
  interruptChat(ref: ChatRef): Promise<ChatSnapshot>;
  answerQuestion(ref: ChatRef, questionId: string, response: JsonValue): Promise<ChatSnapshot>;
  listCron(connectionId: string, profile: string): Promise<CronJob[]>;
  getCronRuns(connectionId: string, profile: string, jobId: string, limit?: number): Promise<CronRun[]>;
  dispose(): Promise<void>;
}

export type ActionName =
  | 'list_connections' | 'list_profiles' | 'list_sessions' | 'open_chat' | 'get_chat'
  | 'list_models' | 'configure_chat' | 'send_message' | 'interrupt_chat' | 'answer_question'
  | 'list_cron_jobs' | 'get_cron_runs';

/** All inputs carry explicit ownership. A profile filter of 'all' is read-only. */
export interface ActionArgs {
  connectionId?: string;
  profile?: string;
  sessionId?: string;
  text?: string;
  questionId?: string;
  response?: JsonValue;
  jobId?: string;
  limit?: number;
  modelId?: string;
  reasoningEffort?: string;
  confirm?: boolean;
}

/** Trusted bridge-only config. Keep tokens in environment variables or private files. */
export interface ConnectionConfig {
  id: string;
  label: string;
  kind: 'http' | 'ssh';
  baseUrl?: string;
  tokenEnv?: string;
  tokenFile?: string;
  cwd?: string;
  ssh?: {
    host: string;
    user?: string;
    port?: number;
    mode?: 'attach' | 'managed';
    remoteHost?: string;
    remotePort?: number;
    hermesHome?: string;
    pythonPath?: string;
    repoPath?: string;
    rendezvousDir?: string;
  };
}

export interface HermesConfig {
  connections: ConnectionConfig[];
}
