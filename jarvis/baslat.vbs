' J.A.R.V.I.S. acilis ekranini Microsoft Edge'de tam ekran baslatir.
' Sesin tiklamadan calmasi icin ayri bir Edge profili ve autoplay izni kullanilir.
Option Explicit
Dim sh, fso, dir, page, profile, cmd

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

dir     = fso.GetParentFolderName(WScript.ScriptFullName)
page    = "file:///" & Replace(Replace(dir & "\index.html", "\", "/"), " ", "%20")
profile = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\JarvisEkrani"

' Masaustu yuklensin diye kisa bir bekleme (bilgisayar acilisinda)
WScript.Sleep 3000

cmd = "msedge --app=""" & page & """" & _
      " --start-fullscreen" & _
      " --autoplay-policy=no-user-gesture-required" & _
      " --user-data-dir=""" & profile & """" & _
      " --no-first-run --no-default-browser-check"

sh.Run cmd, 1, False
