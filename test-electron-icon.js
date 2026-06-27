const { app, shell } = require('electron');

app.whenReady().then(async () => {
  const p = 'C:\\Users\\solar\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Discord Inc\\Discord.lnk';
  const link = shell.readShortcutLink(p);
  console.log('--- LINK PROPS ---');
  console.log(link);

  const getIcon = async (pathStr) => {
    try {
      const img = await app.getFileIcon(pathStr, { size: 'normal' });
      return !img.isEmpty() ? 'SUCCESS (got icon)' : 'EMPTY';
    } catch (e) {
      return `ERROR: ${e.message}`;
    }
  };

  const normalizeCandidate = (s) => {
    let v = String(s || '').trim();
    if (!v) return '';
    v = v.replace(/%([^%]+)%/g, (_m, name) => {
        const key = String(name || '').trim();
        if (!key) return _m;
        return String(process.env[key] ?? _m);
    });

    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
    }

    const m = v.match(/^(.*?),\s*\d+$/);
    if (m && m[1]) return String(m[1]).trim();
    return v;
  };

  const iconPath = normalizeCandidate(link.icon);
  const targetPath = normalizeCandidate(link.target);

  console.log('\n--- TESTING CANDIDATES ---');
  console.log(`p: ${await getIcon(p)}`);
  console.log(`icon: ${iconPath} -> ${await getIcon(iconPath)}`);
  console.log(`target: ${targetPath} -> ${await getIcon(targetPath)}`);
  
  app.quit();
});