import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import type { HermesApi } from './api';
import { chatKey, WorkspaceStore } from './store';
import { Chat, Composer } from './Chat';
import { Cron } from './Cron';
import { Icon } from './icons';

export function HermesWorkspace({ api, embedded = false }: { api: HermesApi; embedded?: boolean }) {
  const store = useMemo(() => new WorkspaceStore(api), [api]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [railOpen, setRailOpen] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia?.('(max-width: 720px)').matches ?? false);
  const railRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const [dark, setDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  const chat = store.getChat();
  const ref = store.getRef();
  const key = ref ? chatKey(ref) : store.getDraftKey();
  const pending = state.pending[key] ?? false;
  const uncertain = state.uncertain[key];
  const ready = Boolean(state.connectionId && state.profile && !state.profilesLoading && state.connectionState !== 'error');

  useEffect(() => { void store.initialise(); }, [store]);
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 720px)');
    if (!media) return;
    const change = () => { setNarrow(media.matches); if (!media.matches) setRailOpen(false); };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (embedded) return;
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark, embedded]);
  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await store.refreshChat();
      if (active) timeout = setTimeout(() => void poll(), store.getChat()?.status === 'streaming' ? 700 : 3000);
    };
    timeout = setTimeout(() => void poll(), 900);
    return () => { active = false; clearTimeout(timeout); };
  }, [store, state.connectionId, state.profile, state.sessionId]);
  useEffect(() => {
    if (!railOpen) return;
    const controls = () => Array.from(railRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []).filter((element) => element.offsetParent !== null);
    controls()[0]?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRailOpen(false);
      if (event.key === 'Tab') {
        const buttons = controls();
        const first = buttons[0]; const last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('keydown', close); openerRef.current?.focus(); };
  }, [railOpen]);

  const connection = state.connections.find((item) => item.id === state.connectionId);
  const selectedProfile = state.profiles.find((profile) => profile.name === state.profile);
  const profileLabel = selectedProfile?.label ?? state.profile;
  const model = chat?.model ?? selectedProfile?.model;
  const statusText = { connected: 'Connected', connecting: 'Connecting…', disconnected: 'Disconnected', error: 'Disconnected' }[state.connectionState];
  const changeTab = (tab: 'chat' | 'cron') => { store.setTab(tab); setRailOpen(false); };

  return <div className={`hermes-shell${railOpen ? ' rail-open' : ''}`}>
    {railOpen && <button className="rail-scrim" onClick={() => setRailOpen(false)} aria-label="Close navigation" />}
    <aside className="rail" ref={railRef} aria-label="Hermes navigation" role={narrow && railOpen ? 'dialog' : undefined} aria-modal={narrow && railOpen ? true : undefined} aria-hidden={narrow && !railOpen ? true : undefined} inert={narrow && !railOpen}>
      <div className="rail-top"><div className="brand"><Icon name="hermes" /><span>Hermes</span></div><button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setRailOpen(false)}><Icon name="close" /></button></div>
      <nav className="rail-nav" aria-label="Workspace">
        <button className="rail-button" onClick={() => { store.newChat(); setRailOpen(false); }} disabled={!ready}><Icon name="new" />New chat</button>
        <button className="rail-button" aria-current={state.tab === 'chat' ? 'page' : undefined} onClick={() => changeTab('chat')}><Icon name="chat" />Chats</button>
        <button className="rail-button" aria-current={state.tab === 'cron' ? 'page' : undefined} onClick={() => changeTab('cron')}><Icon name="clock" />Cron jobs</button>
      </nav>
      <p className="rail-label">Recent conversations</p>
      <div className="session-list">
        {state.sessionsLoading ? <p className="session-empty" role="status">Loading conversations…</p>
          : state.sessions.length ? state.sessions.map((session) => <button className="session-item" key={session.id}
            aria-current={state.sessionId === session.id && state.tab === 'chat' ? 'true' : undefined}
            title={session.title || 'Untitled conversation'} onClick={() => { void store.openSession(session.id); setRailOpen(false); }}>{session.title || 'Untitled conversation'}</button>)
            : <p className="session-empty">{state.profile ? 'Your conversations will appear here.' : 'Choose a profile to see its conversations.'}</p>}
      </div>
      <div className="rail-footer"><div className="rail-footer-text"><strong>{connection?.label ?? 'Hermes extension'}</strong>{profileLabel || 'No profile selected'}</div>
        {!embedded && <button className="icon-button" onClick={() => setDark(!dark)} aria-label={dark ? 'Use light theme' : 'Use dark theme'} title={dark ? 'Use light theme' : 'Use dark theme'}><Icon name={dark ? 'sun' : 'moon'} width="18" height="18" /></button>}
      </div>
    </aside>
    <main className="workspace" inert={narrow && railOpen} aria-hidden={narrow && railOpen ? true : undefined}>
      <header className="topbar">
        <button className="icon-button mobile-menu" ref={openerRef} aria-label="Open navigation" aria-expanded={railOpen} onClick={() => setRailOpen(true)}><Icon name="menu" /></button>
        <div className="topbar-context">
          <div className="scope-select"><label htmlFor="connection">Connection</label><select id="connection" aria-label="Connection" value={state.connectionId} onChange={(event) => void store.selectConnection(event.target.value)} disabled={state.loading || !state.connections.length}>
            {!state.connections.length && <option value="">{state.loading ? 'Loading…' : 'No connections'}</option>}
            {state.connections.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select></div>
          <div className="scope-select"><label htmlFor="profile">Profile</label><select id="profile" aria-label="Profile" value={state.profile} onChange={(event) => void store.selectProfile(event.target.value)} disabled={state.profilesLoading || !state.profiles.length}>
            {!state.profiles.length && <option value="">{state.profilesLoading ? 'Loading profiles…' : 'No profiles'}</option>}
            {state.profiles.map((profile) => <option key={profile.name} value={profile.name}>{profile.label || profile.name}</option>)}
          </select></div>
        </div>
        <span className="connection-state" title={statusText} role="status"><span className="state-dot" data-status={state.connectionState} />{statusText}</span>
      </header>
      {!state.loading && !state.connections.length && <div className="panel-banner"><p>Add a connection in the bridge configuration, then reconnect.</p><Button color="secondary" variant="outline" size="sm" onClick={() => void store.reconnect()}>Reconnect</Button></div>}
      {state.error && <div className="panel-banner error" role="alert"><p>{state.error}</p><Button color="secondary" variant="outline" size="sm" onClick={() => void store.reconnect()}>Reconnect</Button></div>}
      {state.tab === 'chat' ? <>
        {(uncertain || chat?.status === 'unknown') && <div className="panel-banner caution" role="alert"><div><p>{uncertain || 'The previous send outcome is unknown. Reconnect to check this conversation before sending again.'}</p>{state.attempted[key] && <details className="attempted-message"><summary>View the attempted message</summary><pre>{state.attempted[key]}</pre></details>}</div><Button color="secondary" variant="outline" size="sm" disabled={pending} onClick={() => void store.refreshChat()}>Check status</Button></div>}
        {chat?.status === 'interrupted' && <div className="panel-banner"><p>This turn stopped. Review the conversation before continuing.</p></div>}
        <Chat chat={chat} loading={state.chatLoading} pending={pending} ready={ready} profile={profileLabel} onAnswer={store.answer} />
        <Composer draft={state.drafts[store.getDraftKey()] ?? ''} onDraft={(text) => store.setDraft(text)} onSend={() => void store.send()} onStop={() => void store.interrupt()}
          disabled={!ready || state.chatLoading || Boolean(uncertain) || chat?.status === 'unknown' || chat?.status === 'connecting'} busy={chat?.status === 'streaming'} pending={pending} model={model} />
      </> : <Cron state={state} store={store} />}
    </main>
  </div>;
}
