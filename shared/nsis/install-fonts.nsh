; NSIS 安装钩子 - 在安装完成后安装 Maple Mono 字体到用户字体目录
;
; 所有子项目共享此文件，通过 tauri.conf.json 中的 installerHooks 引用
;
; 字体文件通过 tauri.conf.json 的 bundle.resources 配置打包到安装包中，
; 安装后位于 $INSTDIR\resources\fonts\ 目录（NSIS 的 resources 目录）。

!macro NSIS_HOOK_POSTINSTALL
  ; 定义字体源路径（Tauri v2 NSIS 将 resources 打包到 $INSTDIR\resources\）
  !define FONTS_SRC "$INSTDIR\resources\fonts"

  ; 创建用户字体目录（如果不存在）
  CreateDirectory "$LOCALAPPDATA\Microsoft\Windows\Fonts"

  ; 安装 MapleMono-VF.ttf（常规字重）
  IfFileExists "${FONTS_SRC}\MapleMono-VF.ttf" 0 +4
  CopyFiles "${FONTS_SRC}\MapleMono-VF.ttf" "$LOCALAPPDATA\Microsoft\Windows\Fonts"
  WriteRegStr HKCU "Software\Microsoft\Windows NT\CurrentVersion\Fonts" "Maple Mono (TrueType)" "MapleMono-VF.ttf"

  ; 安装 MapleMono-Italic-VF.ttf（斜体字重）
  IfFileExists "${FONTS_SRC}\MapleMono-Italic-VF.ttf" 0 +4
  CopyFiles "${FONTS_SRC}\MapleMono-Italic-VF.ttf" "$LOCALAPPDATA\Microsoft\Windows\Fonts"
  WriteRegStr HKCU "Software\Microsoft\Windows NT\CurrentVersion\Fonts" "Maple Mono Italic (TrueType)" "MapleMono-Italic-VF.ttf"
!macroend
