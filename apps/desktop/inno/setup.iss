; Inno Setup Script for Stuard AI (Windows)
; Builds an installer from electron-builder "dir" output (win-unpacked)
; Includes: Electron app + bundled Python agent
;
; UPDATE MODE: Pass /UPDATE flag to switch UI to "Updating Stuard AI"
;   and auto-relaunch the app after installation.
;   Example: StuardAI-Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /UPDATE

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
; Silent updates: /VERYSILENT /NORESTART /SUPPRESSMSGBOXES /UPDATE

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
; Normal fresh install: show "Launch" checkbox, skip if silent
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent; Check: not IsUpdateMode
; Update mode (non-silent): launch after the wizard finishes
Filename: "{app}\{#MyAppExeName}"; Flags: nowait postinstall skipifnotsilent; Check: IsUpdateMode
; Update mode (silent/verysilent): always relaunch the app automatically
Filename: "{app}\{#MyAppExeName}"; Flags: nowait postinstall; Check: IsUpdateModeSilent

[UninstallDelete]
; Clean up user data on uninstall (optional - commented out to preserve data)
; Type: filesandordirs; Name: "{userappdata}\StuardAI"

[Code]
// ── Detect /UPDATE command-line flag ──
function IsUpdateMode: Boolean;
begin
  Result := ExpandConstant('{param:UPDATE|0}') <> '0';
  // Also check bare /UPDATE switch (no value)
  if not Result then
    Result := Pos('/UPDATE', UpperCase(GetCmdTail)) > 0;
end;

// True when running in update mode AND silent
function IsUpdateModeSilent: Boolean;
begin
  Result := IsUpdateMode and WizardSilent;
end;

// ── Override wizard text when in update mode ──
procedure InitializeWizard;
begin
  if IsUpdateMode then
  begin
    WizardForm.Caption := 'Updating {#MyAppName}';
    // Change the main title bar
    WizardForm.WelcomeLabel1.Caption := 'Updating {#MyAppName}';
    WizardForm.WelcomeLabel2.Caption := 'A new version of {#MyAppName} is being installed. Please wait while the update completes.';
    // Change the "Installing" page text
    WizardForm.StatusLabel.Caption := 'Updating...';
    WizardForm.WizardBitmapImage.Visible := False;
    WizardForm.WizardBitmapImage2.Visible := False;
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if IsUpdateMode then
  begin
    // Override the "Installing" page labels dynamically
    if CurPageID = wpInstalling then
    begin
      WizardForm.PageNameLabel.Caption := 'Updating {#MyAppName}';
      WizardForm.PageDescriptionLabel.Caption := 'Please wait while {#MyAppName} is updated to the latest version.';
      WizardForm.StatusLabel.Caption := 'Updating {#MyAppName}...';
    end;
    // Override "Setup completed" page  
    if CurPageID = wpFinished then
    begin
      WizardForm.FinishedHeadingLabel.Caption := 'Update Complete';
      WizardForm.FinishedLabel.Caption := '{#MyAppName} has been updated successfully. The application will now relaunch.';
    end;
  end;
end;
