// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer, QuestionCard } from '../src/web/Chat';
import { HermesWorkspace } from '../src/web/App';
import type { HermesApi } from '../src/web/api';
import { ModelPicker } from '../src/web/ModelPicker';
import type { ActionName, ActionArgs, ModelCatalogue } from '../src/shared/types';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('chat controls', () => {
  it('sends on Enter, preserves Shift+Enter and ignores IME composition', () => {
    const send = vi.fn();
    render(<Composer draft="Hello" onDraft={vi.fn()} onSend={send} onStop={vi.fn()} disabled={false} busy={false} pending={false} />);
    const composer = screen.getByLabelText('Message Hermes');
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(composer, { key: 'Enter', isComposing: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(composer, { key: 'Enter' });
    expect(send).toHaveBeenCalledOnce();
  });

  it('stops the active turn and keeps Enter from submitting a second prompt', () => {
    const send = vi.fn(); const stop = vi.fn();
    render(<Composer draft="Next prompt" onDraft={vi.fn()} onSend={send} onStop={stop} disabled={false} busy pending={false} />);
    fireEvent.keyDown(screen.getByLabelText('Message Hermes'), { key: 'Enter' });
    fireEvent.click(screen.getByLabelText('Stop response'));
    expect(send).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('answers an approval using its exact upstream option value', async () => {
    const answer = vi.fn().mockResolvedValue(undefined);
    render(<QuestionCard question={{ id: 'q1', kind: 'approval', title: 'Run command?', prompt: 'Read the working directory', options: [{ label: 'Allow once', value: 'once' }, { label: 'Deny', value: 'deny' }] }} disabled={false} onAnswer={answer} />);
    fireEvent.click(screen.getByText('Allow once'));
    expect(answer).toHaveBeenCalledWith('q1', 'once');
  });

  it('can skip a clarification without inventing an answer', () => {
    const answer = vi.fn().mockResolvedValue(undefined);
    render(<QuestionCard question={{ id: 'q2', kind: 'clarify', title: 'Choose a direction', prompt: 'What should happen next?' }} disabled={false} onAnswer={answer} />);
    fireEvent.click(screen.getByText('Skip'));
    expect(answer).toHaveBeenCalledWith('q2', null);
  });
});

describe('narrow navigation', () => {
  it('removes hidden navigation from interaction and exposes a modal drawer with Escape dismissal', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({ matches: query.includes('max-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const api: HermesApi = { async call<T>() { return [] as T; } };
    render(<HermesWorkspace api={api} />);
    const rail = document.querySelector('.rail');
    expect(rail?.hasAttribute('inert')).toBe(true);
    expect(rail?.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(screen.getByLabelText('Open navigation'));
    expect(screen.getByRole('dialog', { name: 'Hermes navigation' })).toBeTruthy();
    expect(rail?.hasAttribute('inert')).toBe(false);
    expect(document.querySelector('main')?.hasAttribute('inert')).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(rail?.hasAttribute('inert')).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('native composer picker', () => {
  it('opens Power, commits keyboard effort, changes model through the advanced view and stays open until Enter', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const catalogue: ModelCatalogue = { connectionId: 'local', profile: 'A', defaultModelId: 'opaque-a', defaultReasoningEffort: 'medium', reasoningEfforts: ['none', 'medium', 'high', 'ultra'], models: [
      { id: 'opaque-a', model: 'model-a', label: 'Model A', provider: 'Provider A' },
      { id: 'opaque-b', model: 'model-a', label: 'Model A', provider: 'Provider B' },
    ] };
    const model = vi.fn(); const reasoning = vi.fn();
    render(<ModelPicker catalogue={catalogue} model={catalogue.models[0]} label="Model A" reasoningEffort="medium" loading={false} disabled={false} onModel={model} onReasoning={reasoning} onDefault={vi.fn()} onReload={vi.fn()} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Model and reasoning: Model A, Medium' }), { button: 0, ctrlKey: false });
    const power = await screen.findByRole('menuitem', { name: /^Power, Medium/ });
    fireEvent.keyDown(power, { key: 'ArrowRight' });
    expect(reasoning).toHaveBeenCalledWith('high');
    reasoning.mockClear();
    fireEvent.keyDown(power, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.keyDown(power, { key: 'Home', code: 'Home' });
    expect(reasoning).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Select model' }));
    const option = await screen.findByRole('menuitemradio', { name: 'Model A Provider B' });
    fireEvent.click(option);
    expect(model).toHaveBeenCalledWith('opaque-b');
    expect(screen.getByRole('menu')).toBeTruthy();
    const restoredPower = screen.getByRole('menuitem', { name: /^Power,/ });
    fireEvent.keyDown(restoredPower, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('uses the real model list for unsupported reasoning and never offers a Power control', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const catalogue: ModelCatalogue = { connectionId: 'local', profile: 'A', defaultModelId: 'no-reasoning', reasoningEfforts: ['none', 'medium', 'high'], models: [{ id: 'no-reasoning', model: 'simple', label: 'Simple', provider: 'Real provider', reasoningSupported: false }] };
    render(<ModelPicker catalogue={catalogue} model={catalogue.models[0]} label="Simple" loading={false} disabled={false} onModel={vi.fn()} onReasoning={vi.fn()} onDefault={vi.fn()} onReload={vi.fn()} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Model and reasoning: Simple' }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole('menuitemradio', { name: 'Simple Real provider' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^Power,/ })).toBeNull();
    expect(screen.getByText('Reasoning is unavailable for this model.')).toBeTruthy();
  });
});

describe('profile navigation rendering', () => {
  it('keeps the selected older chat visible when the recent section is compact', async () => {
    const api: HermesApi = { async call<T>(action: ActionName, args: ActionArgs = {}) {
      const values: Partial<Record<ActionName, unknown>> = {
        list_connections: [{ id: 'local', label: 'Local', kind: 'http', status: 'connected' }], list_profiles: [{ name: 'A', isDefault: true }],
        list_sessions: Array.from({ length: 8 }, (_, index) => ({ id: `chat-${index}`, title: `Chat ${index}`, profile: 'A' })),
        list_models: { connectionId: 'local', profile: 'A', models: [], defaultModelId: '', reasoningEfforts: [] },
        open_chat: { connectionId: 'local', profile: 'A', id: args.sessionId, status: 'idle', cursor: 1, messages: [], tools: [], questions: [] },
      };
      return values[action] as T;
    } };
    render(<HermesWorkspace api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chat 7' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chat 7' }).getAttribute('aria-current')).toBe('page'));
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.getByRole('button', { name: 'Chat 7' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: 'Chat 6' })).toBeNull();
  });

  it('renders the uploaded avatar and separate chat sections, with no profile dropdown, and surfaces authoritative settings warnings', async () => {
    const avatar = 'data:image/png;base64,dGVzdA==';
    const calls: { action: ActionName; args: ActionArgs }[] = [];
    const api: HermesApi = { async call<T>(action: ActionName, args: ActionArgs = {}) {
      calls.push({ action, args });
      const values: Partial<Record<ActionName, unknown>> = {
        list_connections: [{ id: 'local', label: 'Local', kind: 'http', status: 'connected' }],
        list_profiles: [{ name: 'A', avatar, isDefault: true }, { name: 'B', avatar }],
        list_sessions: [{ id: 'same-id', title: `${args.profile} chat`, profile: args.profile }],
        list_models: { connectionId: 'local', profile: args.profile, models: [], defaultModelId: '', reasoningEfforts: [] },
        open_chat: { connectionId: 'local', profile: args.profile, id: 'same-id', status: 'idle', cursor: 1, messages: [], tools: [], questions: [], error: 'Current reasoning settings could not be read back.' },
      };
      return values[action] as T;
    } };
    render(<HermesWorkspace api={api} />);
    await screen.findByRole('button', { name: 'A chat' });
    expect(screen.queryByRole('combobox', { name: 'Profile' })).toBeNull();
    expect(document.querySelector('[title="A avatar"] img')?.getAttribute('src')).toBe(avatar);
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    await screen.findByRole('button', { name: 'B chat' });
    expect(screen.getByRole('button', { name: 'A chat' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'A chat' }));
    await screen.findByText('Current reasoning settings could not be read back.');
    expect(calls.filter((call) => call.action === 'open_chat').at(-1)?.args.profile).toBe('A');
    expect(screen.getByRole('button', { name: 'A' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'A chat' }).getAttribute('aria-current')).toBe('page');
  });
});
