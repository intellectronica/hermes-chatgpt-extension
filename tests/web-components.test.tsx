// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer, QuestionCard } from '../src/web/Chat';
import { HermesWorkspace } from '../src/web/App';
import type { HermesApi } from '../src/web/api';

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
