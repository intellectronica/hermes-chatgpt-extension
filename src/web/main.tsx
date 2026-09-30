import './styles.css';
import { useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { useApp, useHostStyles } from '@modelcontextprotocol/ext-apps/react';
import { Button } from '@openai/apps-sdk-ui/components/Button';
import { createHostApi, createHttpApi } from './api';
import { HermesWorkspace } from './App';
import { Icon } from './icons';

function EmbeddedApp() {
  const { app, isConnected, error } = useApp({
    appInfo: { name: 'Hermes ChatGPT Extension', version: '0.1.0' },
    capabilities: {},
    autoResize: true,
  });
  useHostStyles(app, app?.getHostContext());
  const api = useMemo(() => app ? createHostApi(app) : null, [app]);
  if (error) return <div className="bootstrap"><div><Icon name="hermes" width="36" height="36" /><h1>Could not connect to the host</h1><p>Close and reopen the Hermes panel. If this continues, check that the Hermes plugin is enabled.</p><Button color="secondary" variant="outline" onClick={() => window.location.reload()}>Reconnect</Button></div></div>;
  if (!isConnected || !api) return <div className="bootstrap" role="status"><p>Connecting Hermes to the host…</p></div>;
  return <HermesWorkspace api={api} embedded />;
}

const isEmbedded = window.parent !== window;
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(isEmbedded ? <EmbeddedApp /> : <HermesWorkspace api={createHttpApi()} />);
