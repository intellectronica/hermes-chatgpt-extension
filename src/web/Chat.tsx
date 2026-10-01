import { useEffect, useRef, useState } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { Markdown } from '@openai/apps-sdk-ui/components/Markdown';
import type { ChatMessage, ChatSnapshot, JsonValue, Question, ToolActivity } from '../shared/types';
import { Icon } from './icons';
import { safeMarkdownUrl, statusLabel } from './format';
import { ModelPicker, type ModelPickerProps } from './ModelPicker';
import { ProfileAvatar } from './ProfileAvatar';

function Message({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setCopyError(false);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setCopyError(true); }
  };
  if (message.role === 'user') {
    return <article className="message user" aria-label="Your message">
      <div className="user-bubble">{message.content}</div>
    </article>;
  }
  if (message.role === 'tool') {
    return <details className="tool-activity">
      <summary><Icon name="chevron" />{message.name ?? 'Tool result'}</summary>
      <pre>{message.content}</pre>
    </details>;
  }
  return <article className="message assistant" aria-label={message.role === 'system' ? 'Session information' : 'Hermes message'}>
    {message.role === 'system' && <div className="message-heading">Session information</div>}
    <Markdown className="message-body" skipHtml urlTransform={safeMarkdownUrl} copyableCodeBlocks>
      {message.content}
    </Markdown>
    {!!message.content && <div className="message-actions">
      <button className="icon-button" onClick={() => void copy()} aria-label={copied ? 'Message copied' : 'Copy message'} title={copied ? 'Copied' : 'Copy'}>
        <Icon name={copied ? 'check' : 'copy'} width="16" height="16" />
      </button>
      {copied && <span className="copy-note" role="status">Copied</span>}
      {copyError && <span className="copy-note" role="status">Copy is unavailable in this view.</span>}
    </div>}
  </article>;
}

function Tool({ tool }: { tool: ToolActivity }) {
  return <details className="tool-activity">
    <summary><Icon name="chevron" /><span>{tool.name}</span><span className="tool-status">{statusLabel(tool.state)}</span></summary>
    {tool.input && <pre aria-label="Tool input">{tool.input}</pre>}
    {tool.output ? <pre aria-label="Tool output">{tool.output}</pre> : <pre>{tool.state === 'running' ? 'Waiting for the tool result…' : 'No output was returned.'}</pre>}
  </details>;
}

export function QuestionCard({ question, disabled, onAnswer }: {
  question: Question; disabled: boolean; onAnswer: (questionId: string, response: JsonValue) => Promise<void>;
}) {
  const [answer, setAnswer] = useState('');
  const masked = question.kind === 'secret' || question.kind === 'sudo';
  const respond = (value: JsonValue) => {
    // Do not retain secret responses after handing them to the bridge.
    setAnswer('');
    void onAnswer(question.id, value);
  };
  return <section className="question-card" aria-labelledby={`question-${question.id}`}>
    <h3 id={`question-${question.id}`}>{question.title}</h3>
    <p>{question.prompt}</p>
    {question.options?.length ? <div className="question-actions">
      {question.options.map((option) => <Button key={option.value} color="secondary" variant="outline" size="lg" disabled={disabled} onClick={() => respond(option.value)}>{option.label}</Button>)}
    </div> : question.kind === 'approval' ? <div className="question-actions">
      <Button color="primary" size="lg" disabled={disabled} onClick={() => respond(true)}>Allow</Button>
      <Button color="secondary" variant="outline" size="lg" disabled={disabled} onClick={() => respond(false)}>Deny</Button>
    </div> : <form onSubmit={(event) => { event.preventDefault(); if (answer.trim()) respond(answer); }}>
      <label className="sr-only" htmlFor={`answer-${question.id}`}>{masked ? 'Private response' : 'Your answer'}</label>
      {masked
        ? <input id={`answer-${question.id}`} type="password" autoComplete="off" value={answer} disabled={disabled} onChange={(event) => setAnswer(event.target.value)} />
        : <textarea id={`answer-${question.id}`} rows={2} value={answer} disabled={disabled} onChange={(event) => setAnswer(event.target.value)} placeholder="Your answer" />}
      <div className="question-actions"><Button color="primary" size="lg" type="submit" disabled={disabled || !answer.trim()}>Send answer</Button>{question.kind === 'clarify' && <Button color="secondary" variant="ghost" size="lg" type="button" disabled={disabled} onClick={() => respond(null)}>Skip</Button>}</div>
    </form>}
  </section>;
}

export function Chat({ chat, loading, pending, ready, profile, avatar, onAnswer }: {
  chat?: ChatSnapshot; loading: boolean; pending: boolean; ready: boolean; profile: string; avatar?: string;
  onAnswer: (questionId: string, response: JsonValue) => Promise<void>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const previousId = useRef<string | undefined>(undefined);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (previousId.current !== chat?.id) nearBottom.current = true;
    previousId.current = chat?.id;
    if (nearBottom.current) element.scrollTop = element.scrollHeight;
  }, [chat?.id, chat?.cursor, chat?.messages, chat?.questions, chat?.tools]);

  return <div className="chat-area" ref={scrollRef} onScroll={() => {
    const element = scrollRef.current;
    if (element) nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
  }}>
    {loading && !chat ? <div className="empty-loading" role="status">Opening conversation…</div> : chat ? <section className="transcript" aria-label="Hermes conversation">
      <h1 className="sr-only">Hermes conversation</h1>
      {chat.messages.length === 0 && chat.status === 'idle' && <div className="empty-loading">Send a message to start this conversation.</div>}
      {chat.messages.map((message) => <Message key={message.id} message={message} />)}
      {chat.tools.length > 0 && <div className="tool-group" aria-label="Tool activity">{chat.tools.map((tool) => <Tool key={tool.id} tool={tool} />)}</div>}
      {chat.questions.map((question) => <QuestionCard key={question.id} question={question} disabled={pending} onAnswer={onAnswer} />)}
      {chat.status === 'streaming' && <div className="connection-state" role="status"><span className="stream-placeholder" />{chat.questions.length ? 'Waiting for your answer' : 'Working…'}</div>}
    </section> : <section className="welcome">
      <div className="welcome-mark"><ProfileAvatar avatar={avatar} label={profile || 'Hermes'} size={40} /></div>
      <h1>{ready ? 'What would you like to do?' : 'Connect to Hermes'}</h1>
      <p>{ready ? `Start a conversation with the ${profile} profile.` : 'Choose a connection and profile to start chatting.'}</p>
    </section>}
  </div>;
}

export function Composer({ draft, onDraft, onSend, onStop, disabled, busy, pending, confirmationPending = false, picker }: {
  draft: string; onDraft: (value: string) => void; onSend: () => void; onStop: () => void;
  disabled: boolean; busy: boolean; pending: boolean; confirmationPending?: boolean; picker?: ModelPickerProps;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const textarea = input.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [draft]);
  return <footer className="composer-wrap">
    <form className="composer" onSubmit={(event) => { event.preventDefault(); if (!disabled && !busy && !pending && !confirmationPending && draft.trim()) onSend(); }}>
      <label className="sr-only" htmlFor="hermes-composer">Message Hermes</label>
      <textarea id="hermes-composer" ref={input} rows={1} placeholder="Message Hermes" value={draft}
        disabled={disabled} onChange={(event) => onDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (!disabled && !busy && !pending && !confirmationPending && draft.trim()) onSend();
          }
        }} />
      <div className="composer-footer">
        <div className="composer-controls">{picker && <ModelPicker {...picker} />}<span className="composer-hint sr-only" role="status">{pending ? 'Waiting for Hermes…' : busy ? 'Hermes is working' : 'Enter to send. Shift+Enter for a new line.'}</span></div>
        {busy ? <button type="button" className="submit-button" onClick={onStop} disabled={pending} aria-label="Stop response" title="Stop response"><Icon name="stop" /></button>
          : <button type="submit" className="submit-button" disabled={disabled || pending || confirmationPending || !draft.trim()} aria-label="Send message" title="Send message"><Icon name="send" /></button>}
      </div>
    </form>
  </footer>;
}
