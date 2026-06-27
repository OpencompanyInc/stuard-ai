const { app, shell } = require('electron');

app.whenReady().then(async () => {
    try {
        const link = shell.readShortcutLink('C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Firefox.lnk');
        console.log(link);
    } catch (e) { console.error(e) }
    app.quit();
});