// Popup UI: shows connection/pairing status and the one-time "Allow user
// scripts" helper. The heavy lifting (saved scripts/services) lives in the
// Stuard desktop app; the popup stays focused on getting connected.

const STORAGE_TOKEN = 'stuard_pairing_token';

const chip = document.getElementById('state-chip') as HTMLSpanElement;
const stateLine = document.getElementById('state-line') as HTMLParagraphElement;
const pairSection = document.getElementById('pair-section') as HTMLElement;
const userScriptsSection = document.getElementById('userscripts-section') as HTMLElement;
const tokenInput = document.getElementById('token') as HTMLInputElement;
const saveTokenBtn = document.getElementById('save-token') as HTMLButtonElement;
const openDetailsBtn = document.getElementById('open-details') as HTMLButtonElement;
const reconnectBtn = document.getElementById('reconnect') as HTMLButtonElement;

type StateInfo = { state: string; error?: string; userScriptsAvailable?: boolean };

const COPY: Record<string, { chip: string; cls: string; line: string }> = {
  paired: { chip: 'Connected', cls: 'chip-ok', line: 'Connected and paired with Stuard. Your agent can act on this browser.' },
  connected: { chip: 'Pairing…', cls: 'chip-warn', line: 'Connected to Stuard, finishing the handshake…' },
  needs_pairing: { chip: 'Pair', cls: 'chip-warn', line: 'Almost there — paste the pairing key from the Stuard desktop app.' },
  connecting: { chip: 'Connecting', cls: 'chip-idle', line: 'Connecting to the Stuard desktop app…' },
  disconnected: { chip: 'Offline', cls: 'chip-err', line: 'Stuard desktop app not reachable. Is it running?' },
};

function render(info: StateInfo) {
  const c = COPY[info.state] || COPY.disconnected;
  chip.textContent = c.chip;
  chip.className = `chip ${c.cls}`;
  stateLine.textContent = c.line;

  pairSection.classList.toggle('hidden', info.state === 'paired');
  // Only nudge about user scripts once we're actually connected & paired.
  userScriptsSection.classList.toggle('hidden', !(info.state === 'paired' && info.userScriptsAvailable === false));
}

async function refresh() {
  chrome.runtime.sendMessage({ type: 'getState' }, (resp: StateInfo | undefined) => {
    if (resp) render(resp);
  });
}

// Live updates pushed from the background worker.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'state') {
    chrome.runtime.sendMessage({ type: 'getState' }, (resp: StateInfo | undefined) => {
      if (resp) render(resp);
    });
  }
});

saveTokenBtn.addEventListener('click', () => {
  const token = tokenInput.value.trim();
  if (!token) return;
  saveTokenBtn.textContent = 'Pairing…';
  chrome.runtime.sendMessage({ type: 'setToken', token }, () => {
    saveTokenBtn.textContent = 'Pair';
    void refresh();
  });
});

tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveTokenBtn.click();
});

openDetailsBtn.addEventListener('click', () => {
  // chrome://extensions/?id=<id> deep-links to this extension's details page,
  // where the "Allow user scripts" toggle lives.
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});

reconnectBtn.addEventListener('click', () => {
  reconnectBtn.textContent = 'Reconnecting…';
  chrome.runtime.sendMessage({ type: 'reconnect' }, () => {
    reconnectBtn.textContent = 'Reconnect';
    void refresh();
  });
});

// Prefill the saved token (so re-pairing is one click).
chrome.storage.local.get(STORAGE_TOKEN, (got) => {
  const t = got[STORAGE_TOKEN];
  if (typeof t === 'string' && t) tokenInput.value = t;
});

void refresh();
