!macro customInstall
  CreateDirectory "$INSTDIR\bin"
  CreateDirectory "$INSTDIR\bin\cmd"
  Delete "$INSTDIR\bin\wsm.cmd"
  Delete "$INSTDIR\bin\workspace-manager.cmd"
  CopyFiles /SILENT "$INSTDIR\resources\wsm.ps1" "$INSTDIR\bin"
  CopyFiles /SILENT "$INSTDIR\resources\wsm.ps1" "$INSTDIR\bin\workspace-manager.ps1"
  CopyFiles /SILENT "$INSTDIR\resources\wsm.cmd" "$INSTDIR\bin\cmd"
  CopyFiles /SILENT "$INSTDIR\resources\wsm.cmd" "$INSTDIR\bin\cmd\workspace-manager.cmd"
  CreateDirectory "$APPDATA\workspace-manager"
  CopyFiles /SILENT "$INSTDIR\resources\configure-path.ps1" "$APPDATA\workspace-manager\configure-path.ps1"
  ExecWait '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$APPDATA\workspace-manager\configure-path.ps1" -Action add -BinDir "$INSTDIR\bin" -CmdDir "$INSTDIR\bin\cmd"' $0
  System::Call 'user32::SendMessageTimeout(i 0xffff, i 0x1A, i 0, t "Environment", i 2, i 5000, *i .r0)'
!macroend

!macro customUnInstall
  IfFileExists "$APPDATA\workspace-manager\configure-path.ps1" 0 cli_path_done
  ExecWait '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$APPDATA\workspace-manager\configure-path.ps1" -Action remove -BinDir "$INSTDIR\bin" -CmdDir "$INSTDIR\bin\cmd"' $0
  Delete "$APPDATA\workspace-manager\configure-path.ps1"
  cli_path_done:
  Delete "$INSTDIR\bin\wsm.cmd"
  Delete "$INSTDIR\bin\workspace-manager.cmd"
  Delete "$INSTDIR\bin\wsm.ps1"
  Delete "$INSTDIR\bin\workspace-manager.ps1"
  Delete "$INSTDIR\bin\cmd\wsm.cmd"
  Delete "$INSTDIR\bin\cmd\workspace-manager.cmd"
  RMDir "$INSTDIR\bin\cmd"
  RMDir "$INSTDIR\bin"
  System::Call 'user32::SendMessageTimeout(i 0xffff, i 0x1A, i 0, t "Environment", i 2, i 5000, *i .r0)'
!macroend
