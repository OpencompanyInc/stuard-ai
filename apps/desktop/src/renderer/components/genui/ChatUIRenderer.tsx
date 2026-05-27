import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFastAccessToken } from '../../auth/authManager';
import { resolveAgentEndpoints } from '../../utils/agentEndpoints';

type Scheme = {
  mode: 'dark' | 'light';
  colors: Record<'background' | 'foreground' | 'card' | 'cardForeground' | 'primary' | 'primaryForeground' | 'muted' | 'mutedForeground' | 'border' | 'input' | 'hover' | 'active', string>;
  radius: { card: string; button: string };
};

type Assets = {
  reactUmd: string;
  reactDomUmd: string;
  framerMotionUmd?: string;
  tailwindCss: string;
  extraCss: string;
};

export interface ChatUIRendererProps {
  component: string;
  data?: Record<string, any>;
  css?: string;
  height?: number;
  title?: string;
  blocking?: boolean;
  onResult: (result: any) => void;
  isCompleted?: boolean;
  result?: any;
}

const MAX_HEIGHT = 520;
const MIN_HEIGHT = 72;
const CLOSE_ACTIONS = new Set(['close', 'cancel', 'dismiss', 'exit']);
const CHAT_UI_CSP = [
  "default-src 'none'",
  'img-src data: blob: file: local-file: https: http:',
  'media-src data: blob: file: local-file: https: http:',
  'frame-src data: blob: https: http://localhost:* http://127.0.0.1:*',
  'child-src data: blob: https: http://localhost:* http://127.0.0.1:*',
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  'font-src data: https: http:',
].join(';');

const cssVar = (s: CSSStyleDeclaration, name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
const escScript = (s: string) => String(s || '').replace(/<\/script/gi, '<\\/script');
const fallbackCode = (msg: string) => `function App(){return React.createElement('div',{style:{padding:'16px',border:'1px solid var(--chat-ui-border)',borderRadius:'16px',background:'var(--chat-ui-card)',color:'#ef4444',whiteSpace:'pre-wrap',fontFamily:'ui-monospace,SFMono-Regular,Consolas,monospace'}},${JSON.stringify(msg)})}`;
const safeExternalUrl = (value: unknown) => {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
};

function schemeNow(): Scheme {
  const root = document.documentElement;
  const s = getComputedStyle(root);
  const mode = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  return {
    mode,
    colors: {
      background: cssVar(s, '--background', mode === 'dark' ? '#1e1e1e' : '#f0f2f5'),
      foreground: cssVar(s, '--foreground', mode === 'dark' ? '#ffffff' : '#1a1a1a'),
      card: cssVar(s, '--card-bg', mode === 'dark' ? '#252526' : '#ffffff'),
      cardForeground: cssVar(s, '--foreground', mode === 'dark' ? '#ffffff' : '#1a1a1a'),
      primary: cssVar(s, '--primary', '#007acc'),
      primaryForeground: cssVar(s, '--primary-foreground', '#ffffff'),
      muted: cssVar(s, '--accent', mode === 'dark' ? '#2d2d2d' : '#f8fafc'),
      mutedForeground: cssVar(s, '--foreground-muted', mode === 'dark' ? '#a6a6a6' : '#64748b'),
      border: cssVar(s, '--border', mode === 'dark' ? '#3e3e3e' : '#e2e8f0'),
      input: cssVar(s, '--input-bg', mode === 'dark' ? '#3c3c3c' : '#ffffff'),
      hover: cssVar(s, '--sidebar-item-hover', mode === 'dark' ? '#2a2d2e' : '#cbd5e1'),
      active: cssVar(s, '--sidebar-item-active', mode === 'dark' ? '#37373d' : '#b8c5d6'),
    },
    radius: {
      card: cssVar(s, '--radius-card', '1.5rem'),
      button: cssVar(s, '--radius-button', '0.75rem'),
    },
  };
}

async function bridgedTool(tool: string, args: any) {
  const wsUrl = String(resolveAgentEndpoints().wsUrl || '').trim();
  if (!wsUrl) return window.desktopAPI.execTool(tool, args);
  const accessToken = await getFastAccessToken().catch(() => null);
  return new Promise<any>((resolve) => {
    const id = `chat-ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let done = false;
    let ws: WebSocket | null = null;
    const finish = (result: any) => { if (done) return; done = true; try { ws?.close(); } catch {} resolve(result); };
    const timer = setTimeout(() => finish({ ok: false, error: 'tool_timeout', tool }), 300000);
    try { ws = new WebSocket(wsUrl); } catch (e: any) { clearTimeout(timer); finish({ ok: false, error: e?.message || 'ws_connect_failed' }); return; }
    ws.addEventListener('open', () => {
      try { ws?.send(JSON.stringify({ type: 'exec_tool_bridged', id, tool, args, auth: accessToken ? { accessToken } : undefined })); }
      catch (e: any) { clearTimeout(timer); finish({ ok: false, error: e?.message || 'tool_send_failed' }); }
    });
    ws.addEventListener('message', async (event) => {
      let msg: any; try { msg = JSON.parse(String(event.data || '{}')); } catch { return; }
      const type = String(msg?.type || '').toLowerCase();
      if (type === 'tool_request') {
        const reqId = String(msg?.id || '').trim(); const reqTool = String(msg?.tool || '').trim();
        if (!reqId || !reqTool) return;
        try { ws?.send(JSON.stringify({ type: 'tool_result', id: reqId, result: await window.desktopAPI.execTool(reqTool, msg?.args || {}) })); }
        catch (e: any) { ws?.send(JSON.stringify({ type: 'tool_result', id: reqId, result: { ok: false, error: e?.message || 'local_exec_failed' } })); }
        return;
      }
      if (type === 'exec_tool_bridged_result' && String(msg?.id || '') === id) { clearTimeout(timer); finish(msg?.result || { ok: false, error: 'empty_result' }); }
    });
    ws.addEventListener('error', async () => {
      clearTimeout(timer);
      try { finish(await window.desktopAPI.execTool(tool, args)); }
      catch (e: any) { finish({ ok: false, error: e?.message || 'tool_execution_failed' }); }
    }, { once: true });
    ws.addEventListener('close', () => { clearTimeout(timer); if (!done) finish({ ok: false, error: 'tool_socket_closed' }); });
  });
}

function runtime(code: string, data: Record<string, any>, scheme: Scheme) {
  const safe = escScript(code.replace(/^(\s*)function\s+App\s*\(/m, '$1App = function App('));
  return `(function(){'use strict';var initialData=${JSON.stringify(data)},currentData=Object.assign({},initialData),designScheme=${JSON.stringify(scheme)},pending=Object.create(null),seq=0,listeners=[];window.initialData=initialData;window.formData=currentData;window.designScheme=designScheme;function host(method,payload){return new Promise(function(resolve,reject){var id='rpc-'+Date.now()+'-'+(++seq);pending[id]={resolve:resolve,reject:reject};window.parent.postMessage({type:'stuard:rpc',id:id,method:method,payload:payload||{}},'*');});}function pushData(next){for(var i=0;i<listeners.length;i+=1){try{listeners[i](next);}catch(err){console.error('[chat_ui] data listener error',err);}}}window.addEventListener('message',function(event){if(event.source!==window.parent)return;var msg=event.data;if(!msg||typeof msg!=='object')return;if(msg.type==='stuard:rpc:result'&&msg.id){var p=pending[msg.id];if(!p)return;delete pending[msg.id];if(msg.ok===false){p.reject(new Error(msg.error||'request_failed'));return;}p.resolve(msg.result);return;}if(msg.type==='stuard:data-update'){currentData=Object.assign({},currentData,msg.data||{});window.initialData=currentData;window.formData=currentData;pushData(currentData);}});window.stuard={submit:function(data,keepOpen){window.parent.postMessage({type:'stuard:submit',data:data||{},keepOpen:!!keepOpen},'*');},close:function(data){window.parent.postMessage({type:'stuard:close',data:data||{}},'*');},action:function(actionName,data){window.parent.postMessage({type:'stuard:action',action:actionName||'',data:data||{}},'*');},callTool:function(tool,args){return host('callTool',{tool:tool,args:args||{}});},pickFile:function(options){return host('pickFile',options||{});},pickFolder:function(options){return host('pickFolder',options||{});},pickSavePath:function(options){return host('pickSavePath',options||{});},readFile:function(path,encoding){return host('readFile',{path:path,encoding:encoding});},writeFile:function(path,content){return host('writeFile',{path:path,content:content});},copyToClipboard:function(text){return host('copyToClipboard',{text:text||''});},readClipboard:function(){return host('readClipboard',{});},openExternal:function(url){return host('openExternal',{url:url||''});},notify:function(title,body){return host('notify',{title:title||'',body:body||''});},log:function(message,level){return host('log',{message:message||'',level:level||'info'});},getData:function(){return Promise.resolve(currentData);},updateData:function(updates){currentData=Object.assign({},currentData,updates||{});window.initialData=currentData;window.formData=currentData;window.parent.postMessage({type:'stuard:update-data',data:updates||{}},'*');pushData(currentData);return Promise.resolve(currentData);},onDataUpdate:function(callback){if(typeof callback!=='function')return function(){};listeners.push(callback);return function(){listeners=listeners.filter(function(item){return item!==callback;});};}};var useState=React.useState,useEffect=React.useEffect,useRef=React.useRef,useMemo=React.useMemo,useCallback=React.useCallback,useReducer=React.useReducer,useContext=React.useContext,useLayoutEffect=React.useLayoutEffect,Fragment=React.Fragment,motion=window.Motion&&window.Motion.motion?window.Motion.motion:undefined,AnimatePresence=window.Motion&&window.Motion.AnimatePresence?window.Motion.AnimatePresence:undefined;function height(){try{var h=Math.max(document.body?document.body.scrollHeight:0,document.documentElement?document.documentElement.scrollHeight:0);window.parent.postMessage({type:'stuard:resize',height:h},'*');}catch{}}var App;try{${safe}}catch(componentError){console.error('[chat_ui] definition error',componentError);App=function(){return React.createElement('div',{style:{padding:'16px',border:'1px solid var(--chat-ui-border)',borderRadius:'16px',background:'var(--chat-ui-card)',color:'#ef4444',whiteSpace:'pre-wrap',fontFamily:'ui-monospace,SFMono-Regular,Consolas,monospace'}},'Component Definition Error: '+String(componentError&&componentError.message?componentError.message:componentError));};}try{var root=document.getElementById('root'),Comp=typeof App==='function'?App:function(){return React.createElement('div',{style:{padding:'16px',border:'1px solid var(--chat-ui-border)',borderRadius:'16px',background:'var(--chat-ui-card)',color:'#ef4444'}},'No App component was defined.');};if(ReactDOM.createRoot){ReactDOM.createRoot(root).render(React.createElement(Comp));}else{ReactDOM.render(React.createElement(Comp),root);}}catch(renderError){document.getElementById('root').innerHTML='<div style="padding:16px;border:1px solid var(--chat-ui-border);border-radius:16px;background:var(--chat-ui-card);color:#ef4444;font:13px ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap">Render Error: '+String(renderError&&renderError.message?renderError.message:renderError)+'</div>';}setTimeout(height,60);if(typeof ResizeObserver!=='undefined'&&document.body){new ResizeObserver(height).observe(document.body);}else{setInterval(height,250);}window.addEventListener('load',height);})();`;
}

function srcdoc(assets: Assets, code: string, data: Record<string, any>, css: string, scheme: Scheme) {
  return `<!DOCTYPE html><html class="${scheme.mode === 'dark' ? 'dark' : ''}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CHAT_UI_CSP}"><style>${assets.tailwindCss}</style><style>${assets.extraCss}</style><style>:root{color-scheme:${scheme.mode};--chat-ui-background:${scheme.colors.background};--chat-ui-foreground:${scheme.colors.foreground};--chat-ui-card:${scheme.colors.card};--chat-ui-card-foreground:${scheme.colors.cardForeground};--chat-ui-primary:${scheme.colors.primary};--chat-ui-primary-foreground:${scheme.colors.primaryForeground};--chat-ui-muted:${scheme.colors.muted};--chat-ui-muted-foreground:${scheme.colors.mutedForeground};--chat-ui-border:${scheme.colors.border};--chat-ui-input:${scheme.colors.input};--chat-ui-hover:${scheme.colors.hover};--chat-ui-active:${scheme.colors.active};--chat-ui-radius-card:${scheme.radius.card};--chat-ui-radius-button:${scheme.radius.button};}html,body{margin:0;padding:0;min-height:100%;background:transparent;color:var(--chat-ui-foreground);font-family:'Figtree','Segoe UI',system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;overflow-x:hidden}#root{min-height:100%}.bg-theme-bg{background-color:var(--chat-ui-background)}.bg-theme-card{background-color:var(--chat-ui-card)}.bg-theme-hover{background-color:var(--chat-ui-hover)}.bg-theme-active{background-color:var(--chat-ui-active)}.bg-theme-input{background-color:var(--chat-ui-input)}.bg-theme-muted{background-color:var(--chat-ui-muted)}.bg-theme-primary{background-color:var(--chat-ui-primary)}.text-theme-fg{color:var(--chat-ui-foreground)}.text-theme-muted{color:var(--chat-ui-muted-foreground)}.text-theme-primary{color:var(--chat-ui-primary)}.text-theme-primary-fg{color:var(--chat-ui-primary-foreground)}.border-theme{border-color:var(--chat-ui-border)}.border-theme-primary{border-color:var(--chat-ui-primary)}.rounded-theme-card{border-radius:var(--chat-ui-radius-card)}.rounded-theme-button{border-radius:var(--chat-ui-radius-button)}.divide-theme>*+*{border-color:var(--chat-ui-border)}.hover\\:bg-theme-hover:hover{background-color:var(--chat-ui-hover)}.hover\\:bg-theme-active:hover{background-color:var(--chat-ui-active)}.hover\\:border-theme:hover{border-color:var(--chat-ui-border)}.hover\\:text-theme-fg:hover{color:var(--chat-ui-foreground)}.theme-card{background-color:var(--chat-ui-card);border:1px solid var(--chat-ui-border);border-radius:var(--chat-ui-radius-card)}.theme-btn-primary{background-color:var(--chat-ui-primary);color:var(--chat-ui-primary-foreground);border:none;border-radius:var(--chat-ui-radius-button);padding:.6rem 1rem;font-weight:600;transition:filter 120ms ease,opacity 120ms ease}.theme-btn-primary:hover{filter:brightness(1.08)}.theme-btn-secondary{background-color:var(--chat-ui-hover);color:var(--chat-ui-foreground);border:1px solid var(--chat-ui-border);border-radius:var(--chat-ui-radius-button);padding:.6rem 1rem;font-weight:600;transition:background-color 120ms ease}.theme-btn-secondary:hover{background-color:var(--chat-ui-active)}button{cursor:pointer}input[type="text"],input[type="email"],input[type="password"],input[type="number"],input[type="url"],input[type="tel"],textarea,select{background:var(--chat-ui-input);border:1px solid var(--chat-ui-border);color:var(--chat-ui-foreground);border-radius:.85rem;padding:.7rem .9rem;width:100%;outline:none;transition:border-color 120ms ease,box-shadow 120ms ease}input:focus,textarea:focus,select:focus{border-color:var(--chat-ui-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--chat-ui-primary) 24%,transparent)}input::placeholder,textarea::placeholder{color:color-mix(in srgb,var(--chat-ui-muted-foreground) 82%,transparent)}${css || ''}</style><script>${escScript(assets.reactUmd)}<\/script><script>${escScript(assets.reactDomUmd)}<\/script>${assets.framerMotionUmd ? `<script>${escScript(assets.framerMotionUmd)}<\/script>` : ''}</head><body class="${scheme.mode === 'dark' ? 'dark' : ''}"><div id="root"></div><script>${escScript(runtime(code, data, scheme))}<\/script></body></html>`;
}

export const ChatUIRenderer: React.FC<ChatUIRendererProps> = ({ component, data, css, height, title, blocking = false, onResult, isCompleted, result }) => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const dataRef = useRef<Record<string, any>>(data || {});
  const [assets, setAssets] = useState<Assets | null>(null);
  const [code, setCode] = useState(fallbackCode('Loading chat UI...'));
  const [scheme, setScheme] = useState<Scheme>(() => schemeNow());
  const [autoHeight, setAutoHeight] = useState(height || MIN_HEIGHT);
  const [status, setStatus] = useState<'idle' | 'submitted' | 'dismissed' | 'action'>('idle');
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => { dataRef.current = data || {}; }, [data]);
  useEffect(() => {
    const mo = new MutationObserver(() => setScheme(schemeNow()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    let off = false;
    (async () => {
      setError(null);
      try {
        const [assetRes, txRes] = await Promise.all([window.desktopAPI.customUiGetPrebuiltAssets(), window.desktopAPI.customUiTransformJsx(component || '')]);
        if (off) return;
        if (!assetRes?.ok || !assetRes.reactUmd || !assetRes.reactDomUmd || !assetRes.tailwindCss || !assetRes.extraCss) throw new Error(assetRes?.error || 'custom_ui_assets_unavailable');
        setAssets({ reactUmd: assetRes.reactUmd, reactDomUmd: assetRes.reactDomUmd, framerMotionUmd: assetRes.framerMotionUmd || '', tailwindCss: assetRes.tailwindCss, extraCss: assetRes.extraCss });
        if (!txRes?.ok || !txRes.code) throw new Error(txRes?.error || 'jsx_transform_failed');
        setCode(txRes.code);
      } catch (e: any) {
        const msg = e?.message || 'Failed to initialize chat_ui runtime.';
        setError(msg); setCode(fallbackCode(`chat_ui Error: ${msg}`));
      }
    })();
    return () => { off = true; };
  }, [component]);

  const post = useCallback((msg: any) => { try { frameRef.current?.contentWindow?.postMessage(msg, '*'); } catch {} }, []);
  const handleRpc = useCallback(async (method: string, payload: any) => {
    switch (method) {
      case 'callTool': return bridgedTool(String(payload?.tool || ''), payload?.args || {});
      case 'pickFile': return window.desktopAPI.chatUiPickFile(payload || {});
      case 'pickFolder': return window.desktopAPI.chatUiPickFolder(payload || {});
      case 'pickSavePath': return window.desktopAPI.chatUiPickSavePath(payload || {});
      case 'readFile': return window.desktopAPI.chatUiReadFile(String(payload?.path || ''), payload?.encoding);
      case 'writeFile': await window.desktopAPI.chatUiWriteFile(String(payload?.path || ''), String(payload?.content || '')); return { ok: true };
      case 'copyToClipboard': await window.desktopAPI.chatUiClipboardWrite(String(payload?.text || '')); return { ok: true };
      case 'readClipboard': return window.desktopAPI.chatUiClipboardRead();
      case 'openExternal': {
        const url = safeExternalUrl(payload?.url);
        if (!url) throw new Error('openExternal only supports http(s) URLs');
        await window.desktopAPI.openExternal(url);
        return { ok: true };
      }
      case 'notify': await window.desktopAPI.notify(String(payload?.title || ''), String(payload?.body || '')); return { ok: true };
      case 'log': console.log('[chat_ui]', payload?.level || 'info', payload?.message || ''); return { ok: true };
      default: throw new Error(`Unsupported chat_ui method: ${method}`);
    }
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const msg: any = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'stuard:resize') { if (!height && typeof msg.height === 'number') setAutoHeight(Math.min(Math.max(msg.height, MIN_HEIGHT), MAX_HEIGHT)); return; }
      if (msg.type === 'stuard:update-data') { dataRef.current = { ...dataRef.current, ...(msg.data || {}) }; post({ type: 'stuard:data-update', data: dataRef.current }); return; }
      if (msg.type === 'stuard:rpc') { void handleRpc(msg.method, msg.payload).then((r) => post({ type: 'stuard:rpc:result', id: msg.id, ok: true, result: r })).catch((e) => post({ type: 'stuard:rpc:result', id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e || 'unknown_error') })); return; }
      if (msg.type === 'stuard:submit') {
        dataRef.current = { ...dataRef.current, ...(msg.data || {}) }; setStatus('submitted');
        if (blocking && !resolved && !isCompleted) { setResolved(true); onResult({ ok: true, action: 'submit', data: dataRef.current }); }
        if (!msg.keepOpen) setDismissed(true); return;
      }
      if (msg.type === 'stuard:action') {
        const action = String(msg.action || '').trim() || 'action'; dataRef.current = { ...dataRef.current, ...(msg.data || {}) }; setStatus('action');
        if (blocking && !resolved && !isCompleted) { setResolved(true); onResult({ ok: true, action, data: dataRef.current }); }
        if (CLOSE_ACTIONS.has(action.toLowerCase())) setDismissed(true); return;
      }
      if (msg.type === 'stuard:close') {
        dataRef.current = { ...dataRef.current, ...(msg.data || {}) }; setStatus('dismissed');
        if (blocking && !resolved && !isCompleted) { setResolved(true); onResult({ ok: true, action: 'closed', data: dataRef.current }); }
        setDismissed(true);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [blocking, handleRpc, height, isCompleted, onResult, post, resolved]);

  const doc = useMemo(() => assets ? srcdoc(assets, code, dataRef.current, css || '', scheme) : null, [assets, code, css, scheme]);
  const frameHeight = height ? Math.min(height, MAX_HEIGHT) : autoHeight;
  // Only surface a footer for explicit user actions or errors — no permanent
  // "Displayed" caption on every non-blocking chat_ui.
  const submitted = status === 'submitted' || result?.action === 'submit' || result?.submitted;
  const closed = result?.action === 'closed' || result?.closed;
  const footer = error ? null : submitted ? 'Submitted' : closed ? 'Dismissed' : status === 'action' ? 'Action sent' : null;

  if (dismissed) {
    return <div onClick={(e) => e.stopPropagation()} style={{ margin: '6px 0', color: scheme.colors.mutedForeground, fontSize: 12 }}>{title ? `${title} dismissed` : 'Chat UI dismissed'}</div>;
  }

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ margin: '6px 0' }}>
      {title ? <div style={{ marginBottom: 6, color: scheme.colors.mutedForeground, fontSize: 12, fontWeight: 500 }}>{title}</div> : null}
      {doc ? <iframe ref={frameRef} srcDoc={doc} sandbox="allow-scripts" style={{ width: '100%', height: frameHeight, border: 'none', display: 'block', background: 'transparent', transition: 'height 140ms ease' }} /> : <div style={{ minHeight: height || MIN_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', padding: '8px 0', color: scheme.colors.mutedForeground, fontSize: 13 }}>Loading chat UI...</div>}
      {(footer || error) ? <div style={{ marginTop: 6, color: error ? '#ef4444' : scheme.colors.mutedForeground, fontSize: 11 }}>{error || footer}</div> : null}
    </div>
  );
};
