<span style="display:block;text-align:center">![Skyfox Banner](./docs/readme/banner.png)</span>

Skyfox is a fork of Nocturne (which is a fork of r3dfox) that restores removed Firefox features, UI elements, dialogs, and windows, along with CSS customization options. It keeps Windows 7 and 8 support alive, but primarily targets customized Windows 10/11 builds.

## Features

Skyfox keeps the browser feeling familiar while adding Windows-focused polish and compatibility:

- More native-like controls, scrollbars, checkboxes, radio buttons, and tooltips
- Aero Glass support on Windows 8/10+
- Full portable mode that doesn't touch AppData
- Restored the classic XUL Preferences window, toggleable by setting `browser.preferences.incontent` to `false`.
- Optional classic about:config page, toggleable via `skyfox.ui.oldaboutconfig`
- Less telemetry than regular Firefox
- No background tasks
- Firefox 68-style retry button for failed downloads via `skyfox.ui.ff68downloadicons`
- JPEG XL support
- GPU/hardware acceleration in VMware Workstation 16 and above
- `general.useragent.override.(website)` is back
- Instant one-off searches
- Ability to disable CSP
- Ability to visit websites on ports that Firefox rejects
- Ability to revert icons to the legacy behavior via `skyfox.legacyiconbehavior.enabled`
- Ability to bring back the 16x16 icon via `skyfox.smalliconbehavior.enabled`
- Reimplemented `-moz-win-glass` for a glass look with borders
- Reimplemented the old URL search bar for pre-133 themes

and more!

## Credits

If I've forgotten to put your name here, please let me know and I'll add it.

- [Mozilla Developers](https://www.firefox.com/) - Mozilla Firefox (base)
- [ImSwordQueen and raytek.cafe](https://raytek.cafe/) - Nocturne (base) 
- [Eclipse Community](https://eclipse.cx/) - Eclipse r3dfox (base)
- [Aubymori](https://github.com/aubymori/) & [Isabella Lulamoon](https://github.com/kawapure) - Classic about:config, disabled launcher process, and more from Nara browser
- [Erizur](https://github.com/Erizur/) - Improved native titlebar, modern mode, and some miscellaneous fixes from Marble Browser
- [Isabella Lulamoon](https://github.com/kawapure) - Native Controls Patch
- [Feodor2](https://github.com/Feodor2/) - Portable mode and Vista compatibility changes from Mypal68
- [OmegaAOL](https://github.com/OmegaAOL/) - Classic XUL Preferences window
- [goodusername123](https://github.com/goodusername123/) - Graphical acceleration in VMware Workstation
- [i486](https://github.com/i486/) - Fixed non-native menus
- [leadweedy](https://github.com/leadweedy) - Improved active tab indicator from Firefox-Proton-Square
- [bbc-chi](https://github.com/bbc-chi/) - Fullscreen transition fix
- [Alex313031](https://github.com/Alex313031/) - Mozconfig, general help with the browser, and changes from Mercury browser
- [newbie-461](https://github.com/newbie-461/) - Fixed the installer issues
- [SashaXser](https://github.com/SashaXser/) - Improved rustflags opts in mozconfig
- [Librewolf Developers](https://librewolf.net/) - Privacy tweaks from Librewolf
- [Tor Browser Developers](https://www.torproject.org/) - Addon fix code from Tor Browser
- wanderer - Various code contributions for Vista support / extra help in Nocturne

