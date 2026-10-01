import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import type { HermesApi } from './api';
import { chatKey, ownerKey, WorkspaceStore } from './store';
import { Chat, Composer } from './Chat';
import { Cron } from './Cron';
import { Icon } from './icons';
import { ProfileAvatar } from './ProfileAvatar';

export function HermesWorkspace({ api, embedded = false }: { api: HermesApi; embedded?: boolean }) {
  const store = useMemo(() => new WorkspaceStore(api), [api]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [railOpen, setRailOpen] = useState(false);
  const [allSessions, setAllSessions] = useState<Record<string, boolean>>({});
  const [narrow, setNarrow] = useState(() => window.matchMedia?.('(max-width: 720px)').matches ?? false);
  const railRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const [dark, setDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  const chat = store.getChat();
  const ref = store.getRef();
  const key = ref ? chatKey(ref) : store.getDraftKey();
  const pending = state.pending[key] ?? false;
  const uncertain = state.uncertain[key];
  const confirmation = state.confirmations[key];
  const selection = store.getModelSelection();
  const selectedOwner = ownerKey(state.connectionId, state.profile);
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
    const controls = () => Array.from(railRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), [tabindex="0"]') ?? []).filter((element) => element.offsetParent !== null);
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
  const statusText = { connected: 'Connected', connecting: 'Connecting…', disconnected: 'Disconnected', error: 'Disconnected' }[state.connectionState];
  const changeTab = (tab: 'chat' | 'cron') => { store.setTab(tab); setRailOpen(false); };

  return <div className={`hermes-shell${railOpen ? ' rail-open' : ''}`} data-embedded={embedded}>
    {railOpen && <button className="rail-scrim" onClick={() => setRailOpen(false)} aria-label="Close navigation" />}
    <aside className="rail" ref={railRef} aria-label="Hermes navigation" role={narrow && railOpen ? 'dialog' : undefined} aria-modal={narrow && railOpen ? true : undefined} aria-hidden={narrow && !railOpen ? true : undefined} inert={narrow && !railOpen}>
      <div className="rail-top"><div className="brand"><ProfileAvatar label="Hermes" size={22} /><span>Hermes</span></div><button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setRailOpen(false)}><Icon name="close" /></button></div>
      <nav className="rail-nav" aria-label="Workspace">
        <button className="rail-button" onClick={() => { store.newChat(); setRailOpen(false); }} disabled={!ready || pending}><Icon name="new" />New chat</button>
        <button className="rail-button" aria-current={state.tab === 'cron' ? 'page' : undefined} onClick={() => changeTab('cron')}><Icon name="clock" />Cron jobs</button>
      </nav>
      <div className="profile-sections" role="navigation" aria-label="Profiles and conversations">
        <p className="rail-label">Profiles</p>
        {state.profilesLoading && <p className="session-empty" role="status">Loading profiles…</p>}
        {!state.profilesLoading && !state.profiles.length && <p className="session-empty">No profiles are available for this connection.</p>}
        {state.profiles.map((profile, index) => {
          const owner = ownerKey(state.connectionId, profile.name);
          const section = state.profileSections[owner];
          const selected = profile.name === state.profile;
          const title = profile.label ?? profile.name;
          const recent = section?.sessions.slice(0, 6) ?? [];
          const selectedSession = selected ? section?.sessions.find((session) => session.id === state.sessionId) : undefined;
          const sessions = allSessions[owner] ? section?.sessions : selectedSession && !recent.includes(selectedSession) ? [...recent, selectedSession] : recent;
          return <section className="profile-section" key={owner} data-selected={selected} aria-label={`${title} profile`}>
            <div className="profile-section-heading">
              <button className="profile-section-button" aria-expanded={section?.expanded ?? false} aria-controls={section?.expanded ? `profile-sessions-${index}` : undefined}
                aria-pressed={selected} title={title} onClick={() => store.toggleProfile(profile.name)}>
                <ProfileAvatar avatar={profile.avatar} label={title} />
                <span className="profile-section-label">{title}</span><Icon name="chevron" className={`section-chevron${section?.expanded ? ' expanded' : ''}`} width="16" height="16" />
              </button>
              <button className="icon-button profile-new" aria-label={`New chat in ${title}`} title={`New chat in ${title}`} disabled={selected && pending}
                onClick={() => { store.newProfileChat(profile.name); setRailOpen(false); }}><Icon name="plus" width="16" height="16" /></button>
            </div>
            {section?.expanded && <div className="profile-session-list" id={`profile-sessions-${index}`}>
              {section.loading && !section.loaded ? <p className="session-empty" role="status">Loading chats…</p> : sessions?.map((session) => <button className="session-item" key={session.id}
                aria-current={selected && state.sessionId === session.id && state.tab === 'chat' ? 'page' : undefined}
                title={session.title || 'Untitled chat'} onClick={() => { void store.openProfileSession(profile.name, session.id); setRailOpen(false); }}>{session.title || 'Untitled chat'}</button>)}
              {section.error && <div className="section-error" role="alert"><p>{section.error}</p><button onClick={() => void store.loadProfileSessions(state.connectionId, profile.name)}>Retry</button></div>}
              {!section.loading && !section.error && !section.sessions.length && <p className="session-empty">No recent chats</p>}
              {section.sessions.length > 6 && <button className="session-item show-more" onClick={() => setAllSessions({ ...allSessions, [owner]: !allSessions[owner] })}>{allSessions[owner] ? 'Show less' : 'Show more'}</button>}
            </div>}
          </section>;
        })}
      </div>
      <div className="rail-footer"><div className="rail-footer-text"><div className="scope-select"><label className="sr-only" htmlFor="connection">Connection</label><select id="connection" aria-label="Connection" value={state.connectionId} onChange={(event) => void store.selectConnection(event.target.value)} disabled={state.loading || !state.connections.length}>
        {!state.connections.length && <option value="">{state.loading ? 'Loading…' : 'No connections'}</option>}
        {state.connections.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></div><span>{connection?.kind === 'ssh' ? 'Remote Hermes' : 'Hermes connection'}</span></div>
        {!embedded && <button className="icon-button" onClick={() => setDark(!dark)} aria-label={dark ? 'Use light theme' : 'Use dark theme'} title={dark ? 'Use light theme' : 'Use dark theme'}><Icon name={dark ? 'sun' : 'moon'} width="18" height="18" /></button>}
      </div>
    </aside>
    <main className="workspace" inert={narrow && railOpen} aria-hidden={narrow && railOpen ? true : undefined}>
      <header className="topbar">
        <button className="icon-button mobile-menu" ref={openerRef} aria-label="Open navigation" aria-expanded={railOpen} onClick={() => setRailOpen(true)}><Icon name="menu" /></button>
        <div className="topbar-context"><span className="topbar-profile">{profileLabel || 'Hermes'}</span><span className="context-divider">/</span><span className="topbar-title">{state.tab === 'cron' ? 'Cron jobs' : state.sessions.find((session) => session.id === state.sessionId)?.title || (state.sessionId ? 'Conversation' : 'New chat')}</span></div>
        <span className="connection-state" title={statusText} role="status"><span className="state-dot" data-status={state.connectionState} />{statusText}</span>
      </header>
      {!state.loading && !state.connections.length && <div className="panel-banner"><p>Add a connection in the bridge configuration, then reconnect.</p><Button color="secondary" variant="outline" size="sm" onClick={() => void store.reconnect()}>Reconnect</Button></div>}
      {state.error && <div className="panel-banner error" role="alert"><p>{state.error}</p><Button color="secondary" variant="outline" size="sm" onClick={() => void store.reconnect()}>Reconnect</Button></div>}
      {state.tab === 'chat' ? <>
        {(uncertain || chat?.status === 'unknown') && <div className="panel-banner caution" role="alert"><div><p>{uncertain || chat?.error || 'The previous send outcome is unknown. Reconnect to check this conversation before sending again.'}</p>{uncertain && chat?.error && chat.error !== uncertain && <p>{chat.error}</p>}{state.attempted[key] && <details className="attempted-message"><summary>View the attempted message</summary><pre>{state.attempted[key]}</pre></details>}</div><Button color="secondary" variant="outline" size="sm" disabled={pending} onClick={() => void store.refreshChat()}>Check status</Button></div>}
        {chat?.status === 'interrupted' && <div className="panel-banner"><p>This turn stopped. Review the conversation before continuing.</p></div>}
        {chat?.error && chat.error !== uncertain && chat.status !== 'unknown' && <div className="panel-banner caution" role="status"><p>{chat.error}</p><Button color="secondary" variant="outline" size="sm" disabled={pending} onClick={() => void store.refreshChat()}>Check settings</Button></div>}
        {confirmation && <section className="configuration-confirmation" aria-labelledby="configuration-title" role="alert"><h2 id="configuration-title">{confirmation.title}</h2><p>{confirmation.message}</p><div className="question-actions"><Button color="primary" size="sm" disabled={pending} onClick={() => void store.confirmConfiguration()}>Use this model</Button><Button color="secondary" variant="outline" size="sm" disabled={pending} onClick={() => store.cancelConfiguration()}>Cancel</Button></div></section>}
        <Chat chat={chat} loading={state.chatLoading} pending={pending} ready={ready} profile={profileLabel} avatar={selectedProfile?.avatar} onAnswer={store.answer} />
        <Composer key={key} draft={state.drafts[store.getDraftKey()] ?? ''} onDraft={(text) => store.setDraft(text)} onSend={() => void store.send()} onStop={() => void store.interrupt()}
          disabled={!ready || state.chatLoading || Boolean(uncertain) || chat?.status === 'unknown' || chat?.status === 'connecting'} busy={chat?.status === 'streaming'} pending={pending} confirmationPending={Boolean(confirmation)}
          picker={{ ...selection, loading: state.modelsLoading[selectedOwner] ?? false, error: state.modelsError[selectedOwner],
            disabled: !ready || state.chatLoading || pending || Boolean(uncertain || confirmation) || Boolean(chat?.questions.length) || chat?.status === 'streaming' || chat?.status === 'unknown' || chat?.status === 'connecting',
            onModel: (id) => void store.chooseModel(id), onReasoning: (effort) => void store.chooseReasoning(effort), onDefault: () => void store.useProfileDefault(), onReload: () => void store.loadModels() }} />
      </> : <Cron state={state} store={store} />}
    </main>
  </div>;
}
