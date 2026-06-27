/**
 * Live test: connect to the running cloud-ai server via WebSocket,
 * send a chat message with skills in context, and verify the agent
 * can see them in its system prompt.
 */
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import os from 'os';

const WS_URL = 'ws://127.0.0.1:8082/ws';
const SKILLS_FILE = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  '@stuardai/desktop/skills.json'
);

function loadSkills() {
  try {
    const data = JSON.parse(fs.readFileSync(SKILLS_FILE, 'utf8'));
    const active = data.filter((s: any) => s.isActive !== false);
    console.log(`\n[skills.json] Found ${data.length} skills, ${active.length} active:`);
    for (const s of active) console.log(`  • ${s.name} (id=${s.id}, isActive=${s.isActive})`);
    return active;
  } catch (e) {
    console.error('[ERROR] Could not read skills.json:', e);
    return [];
  }
}

function runTest(skills: any[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const chunks: string[] = [];
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) { ws.close(); reject(new Error('Timeout after 60s')); }
    }, 60000);

    ws.on('open', () => {
      console.log(`\n[ws] Connected to ${WS_URL}`);

      const payload = {
        type: 'chat',
        text: 'List every skill you currently have available. Be explicit — name each one.',
        model: 'fast',
        history: [],
        context: {
          skills,      // <-- the active skills from disk
        },
      };

      console.log(`[ws] Sending message with ${skills.length} skills in context...`);
      ws.send(JSON.stringify(payload));
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Log every non-delta message for debugging
        if (!(msg.type === 'progress' && msg.event === 'delta')) {
          console.log(`[ws msg] type=${msg.type} event=${msg.event || ''} data=${JSON.stringify(msg.data || msg.message || msg).slice(0, 200)}`);
        }

        // Auto-respond to tool_request so the agent isn't blocked waiting for desktop
        if (msg.type === 'tool_request') {
          const toolName = msg.tool || msg.name || '?';
          console.log(`  → auto-responding to tool_request: ${toolName} (id=${msg.id})`);
          ws.send(JSON.stringify({
            type: 'tool_result',
            id: msg.id,
            result: { ok: true, data: null, message: 'mock result from test script' },
          }));
        }

        if (msg.type === 'progress' && msg.event === 'delta' && msg.data?.text) {
          process.stdout.write(msg.data.text);
          chunks.push(msg.data.text);
        }

        if (msg.type === 'final' || msg.type === 'error') {
          done = true;
          clearTimeout(timeout);
          ws.close();

          const fullText = chunks.join('');
          console.log('\n\n=== ANALYSIS ===');

          const skillNames = skills.map((s: any) => s.name.toLowerCase());
          let found = 0;
          for (const name of skillNames) {
            const present = fullText.toLowerCase().includes(name.toLowerCase());
            console.log(`  ${present ? '✅' : '❌'} "${name}" ${present ? 'found' : 'NOT found'} in response`);
            if (present) found++;
          }

          console.log(`\n${found}/${skills.length} skills visible to agent`);

          if (msg.type === 'error') {
            console.log('\n[ERROR from server]:', msg.message);
          }

          if (found === skills.length) {
            console.log('✅ FIX CONFIRMED — agent sees all skills');
          } else if (found === 0) {
            console.log('❌ BUG STILL PRESENT — agent sees no skills');
          } else {
            console.log('⚠️  PARTIAL — agent sees some skills');
          }

          resolve();
        }
      } catch { }
    });

    ws.on('error', (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  });
}

async function main() {
  console.log('=== SKILLS LIVE TEST ===');
  const skills = loadSkills();

  if (skills.length === 0) {
    console.log('\n❌ No active skills found on disk — nothing to test');
    process.exit(1);
  }

  await runTest(skills);
}

main().catch(e => { console.error(e); process.exit(1); });
