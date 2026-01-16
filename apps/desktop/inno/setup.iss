; Inno Setup Script for Stuard AI (Windows)
; Builds an installer from electron-builder "dir" output (win-unpacked)
; Includes: Electron app + bundled Python agent

#define MyAppName "Stuard AI"
#define MyAppPublisher "StuardAI"
#define MyAppURL "https://stuard.ai"
#define MyAppExeName "Stuard AI.exe"

; Version provided by CI via /D flag; falls back to 0.0.0 if missing
#ifndef MY_APP_VERSION
  #define MY_APP_VERSION "0.0.0"
#endif

[Setup]
AppId={{A8F4C3A7-78D9-4F6B-9C3F-5B9B6E0B9A1C}}
AppName={#MyAppName}
AppVersion={#MY_APP_VERSION}
AppVerName={#MyAppName} {#MY_APP_VERSION}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableDirPage=no
DisableProgramGroupPage=yes
LicenseFile=
OutputDir=..\release
OutputBaseFilename=StuardAI-Setup-{#MY_APP_VERSION}
; SetupIconFile=..\build\icon.ico  ; Add icon.ico to build/ folder to enable
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
WizardStyle=modern
; Silent updates: /VERYSILENT /NORESTART /SUPPRESSMSGBOXES

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"
Name: "startupicon"; Description: "Start {#MyAppName} when Windows starts"; GroupDescription: "Startup:"; Flags: unchecked

[Files]
; Electron app + Python agent (in resources/agent/)
Source: "..\release\win-unpacked\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: startupicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Clean up user data on uninstall (optional - commented out to preserve data)
; Type: filesandordirs; Name: "{userappdata}\StuardAI"
