import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Menu } from '@openai/apps-sdk-ui/components/Menu';
import type { ModelCatalogue, ModelOption } from '../shared/types';
import { Icon } from './icons';

export const effortLabel = (value: string) => value === 'xhigh' ? 'Extra high' : value.charAt(0).toUpperCase() + value.slice(1);

export interface ModelPickerProps {
  catalogue?: ModelCatalogue;
  model?: ModelOption;
  label: string;
  reasoningEffort?: string;
  profileDefault?: boolean;
  loading: boolean;
  error?: string;
  disabled: boolean;
  onModel: (id: string) => void;
  onReasoning: (effort: string) => void;
  onDefault: () => void;
  onReload: () => void;
}

/** Codex's current compact Power view and its separate model list. */
export function ModelPicker({ catalogue, model, label, reasoningEffort, profileDefault = false, loading, error, disabled, onModel, onReasoning, onDefault, onReload }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'simple' | 'models'>('simple');
  const [preview, setPreview] = useState(reasoningEffort);
  const [contentWidth, setContentWidth] = useState<number>();
  const triggerContent = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  const dragIndex = useRef(0);
  const slider = useRef<HTMLDivElement>(null);
  const efforts = catalogue?.reasoningEfforts.filter((effort) => effort !== 'none' || model?.canDisableReasoning !== false) ?? [];
  const powerAvailable = model?.reasoningSupported !== false && efforts.length > 1 && Boolean(reasoningEffort);
  const simple = view === 'simple' && powerAvailable && !loading && !error;
  const selectedIndex = Math.max(0, efforts.indexOf(preview ?? reasoningEffort ?? ''));
  const defaultModel = catalogue?.models.find((option) => option.id === catalogue.defaultModelId);

  useEffect(() => { if (!dragging.current && !disabled) setPreview(reasoningEffort); }, [reasoningEffort, model?.id, disabled]);
  useEffect(() => { setOpen(false); }, [catalogue?.connectionId, catalogue?.profile]);

  const commit = (index: number) => {
    const effort = efforts[index];
    if (!disabled && effort && effort !== reasoningEffort) onReasoning(effort);
  };
  const pointerIndex = (clientX: number) => {
    const bounds = slider.current?.getBoundingClientRect();
    if (!bounds || !bounds.width) return selectedIndex;
    return Math.max(0, Math.min(efforts.length - 1, Math.round((clientX - bounds.left - 14) / (bounds.width - 28) * (efforts.length - 1))));
  };

  return <Menu forceOpen={open} onOpen={() => { setContentWidth(triggerContent.current?.getBoundingClientRect().width); setView('simple'); setOpen(true); }} onClose={() => { dragging.current = false; setPreview(reasoningEffort); setOpen(false); }}>
    <Menu.Trigger disabled={disabled}>
      <button type="button" className="model-trigger" disabled={disabled} aria-label={`Model and reasoning: ${label}${reasoningEffort ? `, ${effortLabel(reasoningEffort)}` : ''}`} data-selected-reasoning-effort={reasoningEffort} title={open && simple && !profileDefault ? 'Select effort' : 'Select model'}>
        <span ref={triggerContent} className="model-trigger-content" style={open && contentWidth ? { minWidth: contentWidth } : undefined}><span className="model-trigger-name">{open && simple ? profileDefault ? 'Select model' : 'Select effort' : label}</span>
        {reasoningEffort && !(open && simple) && <span className="model-trigger-effort">{effortLabel(reasoningEffort)}</span>}</span>
        <Icon name="chevron" className="down-chevron" width="12" height="12" />
      </button>
    </Menu.Trigger>
    <span className="sr-only" role="status" aria-live="polite">{open && simple && preview ? `${effortLabel(preview)}, ${selectedIndex + 1} of ${efforts.length}.` : ''}</span>
    <Menu.Content side="top" align="center" width={254} minWidth={254} sideOffset={8} maxHeight={400}>
      <div className="native-picker" data-view={simple ? 'simple' : 'models'}>
        {simple ? <>
          <div className="power-heading" data-explicit={!profileDefault}>
            <Menu.Item className="power-model-choice" disabled={disabled} onSelect={(event) => { event.preventDefault(); setView('models'); }}>
              <span className="sr-only">Select model</span><span className="power-choice-label" aria-hidden="true"><span className="power-model-label">{label}</span><span className="power-effort-label" data-maximum={preview === 'ultra' || preview === 'max'}>{preview ? effortLabel(preview) : ''}</span><Icon name="chevron" width="12" height="12" /></span>
            </Menu.Item>
            <Menu.Item className="power-reset" disabled={disabled || profileDefault} onSelect={(event) => { event.preventDefault(); onDefault(); }}><span className="sr-only">Reset to default</span><span title="Reset to default"><Icon name="refresh" width="14" height="14" /></span></Menu.Item>
          </div>
          <div className="power-keyboard-control" onKeyDownCapture={(event) => {
            if (disabled) return;
            if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault(); event.stopPropagation();
              const index = Math.max(0, Math.min(efforts.length - 1, selectedIndex + (event.key === 'ArrowRight' ? 1 : -1)));
              setPreview(efforts[index]); commit(index);
            }
          }}>
            <Menu.Item disabled={disabled} className="power-menu-item" onSelect={(event) => event.preventDefault()}>
            <span className="sr-only">Power, {preview ? effortLabel(preview) : 'Unknown'}. Use Left and Right arrow keys to adjust power. Enter to close.</span>
            <div className="power-slider" ref={slider} style={{ '--power-fill': `${100 * selectedIndex / (efforts.length - 1)}%` } as CSSProperties} data-maximum={preview === 'ultra' || preview === 'max'} aria-hidden="true"
              onPointerDown={(event) => { if (disabled) return; event.preventDefault(); dragging.current = true; dragIndex.current = pointerIndex(event.clientX); setPreview(efforts[dragIndex.current]); event.currentTarget.setPointerCapture?.(event.pointerId); }}
              onPointerMove={(event) => { if (dragging.current) { dragIndex.current = pointerIndex(event.clientX); setPreview(efforts[dragIndex.current]); } }}
              onPointerUp={(event) => { if (dragging.current) { dragging.current = false; event.currentTarget.releasePointerCapture?.(event.pointerId); commit(dragIndex.current); } }}
              onPointerCancel={() => { dragging.current = false; setPreview(reasoningEffort); }}>
            <div className="power-track" aria-hidden="true"><div className="power-fill" /><div className="power-ticks">{efforts.map((effort, index) => <span key={effort} style={{ left: `${100 * index / (efforts.length - 1)}%` }} />)}</div></div>
            <span className="power-thumb" style={{ left: `calc(14px + (100% - 28px) * ${selectedIndex / (efforts.length - 1)})` }} />
            </div>
            </Menu.Item>
          </div>
          <p className="sr-only" id="power-description">Hermes adapts effort to the model’s support.</p>
        </> : <>
          <div className="picker-label">Select model</div>
          {loading ? <div className="picker-note" role="status">Loading models…</div> : error ? <>
            <div className="picker-note picker-error" role="alert">{error}</div>
            <Menu.Item onSelect={(event) => { event.preventDefault(); onReload(); }}><Icon name="refresh" width="16" height="16" />Refresh models</Menu.Item>
          </> : catalogue ? <div className="model-options" role="group" aria-label="Available models" tabIndex={0}>
            <Menu.RadioGroup value={profileDefault ? 'profile-default' : model?.id ?? ''} onChange={(value) => { if (value === 'profile-default') onDefault(); else onModel(value); setView('simple'); }}>
              <Menu.RadioItem value="profile-default" disabled={disabled} className="model-option" onSelect={(event) => { event.preventDefault(); setView('simple'); }}>
                <span><span className="model-option-name">Default</span>{' '}<span className="model-option-provider">{defaultModel?.label ?? 'This profile’s configured model'}</span></span>{profileDefault && <Icon name="check" width="16" height="16" />}
              </Menu.RadioItem>
              {catalogue.models.map((option) => <Menu.RadioItem key={option.id} value={option.id} disabled={disabled} className="model-option" onSelect={(event) => { event.preventDefault(); setView('simple'); }}>
                <span><span className="model-option-name">{option.label}</span>{' '}<span className="model-option-provider">{option.providerLabel ?? option.provider}</span></span>{!profileDefault && option.id === model?.id && <Icon name="check" width="16" height="16" />}
              </Menu.RadioItem>)}
            </Menu.RadioGroup>
            {!catalogue.models.length && <div className="picker-note">No selectable models were returned.</div>}
          </div> : <div className="picker-note">No model list is available. New chats use the profile’s configured model.</div>}
          {!loading && !error && model?.reasoningSupported === false && <div className="picker-note">Reasoning is unavailable for this model.</div>}
          {!loading && !error && model?.reasoningSupported !== false && !reasoningEffort && <div className="picker-note">Current reasoning effort is unavailable.</div>}
        </>}
      </div>
    </Menu.Content>
  </Menu>;
}
