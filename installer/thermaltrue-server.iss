; Thermaltrue WMS — Server Installer (PostgreSQL 18 + API server + web assets + optional Desktop client)
; Build: installer\build-installer.ps1
#ifndef AppVer
  #define AppVer "1.0.4"
#endif
#define MyAppName "Thermaltrue WMS"
#define ServerExe "server.exe"
#define PgInstaller "postgresql-18.4-1-windows-x64.exe"
#define ClientMsi "Thermaltrue_1.0.4_x64_en-US"

[Setup]
AppId={{31B2E4D9-9C7E-4A53-B8E6-7F0A2D2C9E11}
AppName={#MyAppName}
AppVersion={#AppVer}
AppPublisher=Thermaltrue
DefaultDirName={autopf}\Thermaltrue
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#ServerExe}
OutputDir=..\dist-installer
OutputBaseFilename=Thermaltrue-Setup-{#AppVer}
SetupIconFile=payload\icon.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
DisableDirPage=no
MinVersion=10.0.19044

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "full"; Description: "Full (server + bundled database + client)"
Name: "server"; Description: "Server only (server + bundled database)"
Name: "client"; Description: "Client app only (no server)"

[Components]
Name: "server"; Description: "API server + web interface"; Types: full server; Flags: fixed
Name: "postgresql"; Description: "PostgreSQL 18 (bundled installer)"; Types: full server
Name: "client"; Description: "Thermaltrue Desktop client"; Types: full client

[Tasks]
Name: "start_service"; Description: "Start Thermaltrue server service after install"; Components: server

[Files]
Source: "payload\server.exe"; DestDir: "{app}"; Components: server; Flags: ignoreversion
Source: "payload\dist\*"; DestDir: "{app}\dist"; Components: server; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "payload\selftest.ps1"; DestDir: "{app}"; Components: server; Flags: ignoreversion
Source: "payload\{#PGInstaller}"; DestDir: "{tmp}"; Components: postgresql; Flags: deleteafterinstall
Source: "payload\{#ClientMsi}.msi"; DestDir: "{tmp}"; Components: client; Flags: deleteafterinstall

[Run]
Filename: "{tmp}\{#PGInstaller}"; Parameters: "--mode unattended --unattendedmodeui none --superpassword {code:GetPgPass} --serverport {code:GetPgPort}"; WorkingDir: "{tmp}"; StatusMsg: "Installing PostgreSQL 18..."; Flags: runhidden waituntilterminated; Components: postgresql
Filename: "{app}\{#ServerExe}"; Parameters: "install"; WorkingDir: "{app}"; StatusMsg: "Registering service..."; Flags: runhidden waituntilterminated; Components: server
Filename: "cmd.exe"; Parameters: "/c taskkill /im Thermaltrue.exe /f >nul 2>&1 & msiexec /I ""{tmp}\{#ClientMsi}.msi"" /QN"; WorkingDir: "{app}"; StatusMsg: "Installing client..."; Flags: runhidden waituntilterminated; Components: client
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\selftest.ps1"" -Port {code:GetApiPort}"; WorkingDir: "{app}"; StatusMsg: "Verifying installation..."; Flags: runhidden waituntilterminated; Components: server

[Icons]
Name: "{group}\Thermaltrue Server (status)"; Filename: "{app}\{#ServerExe}"; WorkingDir: "{app}"; Parameters: "status"; Components: server
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"

[Registry]
Root: HKLM; Subkey: "SOFTWARE\Thermaltrue"; ValueType: string; ValueName: "InstallPath"; ValueData: "{app}"; Flags: uninsdeletekey
Root: HKLM; Subkey: "SOFTWARE\Thermaltrue"; ValueType: string; ValueName: "Version"; ValueData: "{#AppVer}"; Flags: uninsdeletekey

[Code]
var
  PgPass: string;
  PgPort: string;
  ApiPort: string;
  PortsPage: TInputQueryWizardPage;

function GetPgPass(Param: String): String;
var
  i: Integer;
  Chars: string;
begin
  if Length(PgPass) > 0 then begin Result := PgPass; Exit; end;
  Chars := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  Result := '';
  for i := 1 to 16 do Result := Result + Copy(Chars, Random(Length(Chars)) + 1, 1);
  PgPass := Result;
end;

function GetPgPort(Param: String): String;
begin
  Result := PgPort;
end;

function GetApiPort(Param: String): String;
begin
  Result := ApiPort;
end;

function GetPort(Param: String): String;
begin
  Result := PgPort;
end;

procedure InitializeWizard;
begin
  PortsPage := CreateInputQueryPage(wpSelectComponents,
    'Server ports', 'Ports used by the API server and PostgreSQL',
    'Leave defaults unless you already run services on these ports.');
  PortsPage.Add('API server port (default 3000):', False);
  PortsPage.Add('PostgreSQL port (default 5432):', False);
  PortsPage.Values[0] := '3000';
  PortsPage.Values[1] := '5432';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = PortsPage.ID then
  begin
    ApiPort := PortsPage.Values[0];
    PgPort  := PortsPage.Values[1];
    if StrToIntDef(ApiPort, 0) = 0 then Result := False
    else if StrToIntDef(PgPort, 0) = 0 then Result := False;
  end;
end;

procedure WriteEnvFile;
var
  S: string;
begin
  S := 'APP_MODE=production' + #13#10 +
       'DATABASE_URL=postgresql://postgres:' + PgPass + '@localhost:' + PgPort + '/thermaltrue?sslmode=disable' + #13#10 +
       'PORT=' + ApiPort + #13#10 +
       'CORS_ORIGIN=' + #13#10 +
       'RUST_LOG=info' + #13#10;
  SaveStringToFile(AddBackslash(ExpandConstant('{app}')) + '.env', S, False);
end;

procedure WriteCredsFile;
var
  S: string;
begin
  S := 'Thermaltrue WMS — credentials from installer' + #13#10 +
       'API port: ' + ApiPort + #13#10 +
       'PostgreSQL port: ' + PgPort + '  user: postgres  password: ' + PgPass + #13#10 +
       'Admin user seeded by server (see server log; DEFAULT_ADMIN_PASSWORD may be set in .env)' + #13#10;
  SaveStringToFile(AddBackslash(ExpandConstant('{app}')) + 'installer-notes.txt', S, False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    WriteEnvFile;
    WriteCredsFile;
  end;
end;
