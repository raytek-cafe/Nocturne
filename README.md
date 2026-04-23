<span style="display:block;text-align:center">![raytek Nocturne](./docs/readme/nocturne_banner.png)</span>

Nocturne is a fork of r3dfox that restores removed Firefox CSS customization options, keeps Windows 7 and 8 support alive, and targets customized Windows 10/11 builds.

[![Github All Releases](https://img.shields.io/github/downloads/raytek-cafe/nocturne/total.svg)](https://github.com/raytek-cafe/Nocturne/releases/latest)
[![Star][star-badge]][star]

[star]: https://github.com/raytek-cafe/Nocturne/stargazers
[star-badge]: https://img.shields.io/github/stars/raytek-cafe/Nocturne

#### Nocturne on Windows 10
<p align="center">
  <img width="1440" height="900" alt="Nocturne Browser on Windows 10" src="./docs/readme/Nocturne_Win10.png" />
</p>

<hr />

#### Nocturne on Windows 7 (With [Geckium](https://github.com/angelbruni/Geckium/) installed)
<p align="center">
  <img width="1440" height="900" alt="Nocturne on Windows 7 with Geckium" src="./docs/readme/Nocturne_Geckium_Win7.png" />
</p>

<hr />

#### Nocturne on Windows 10 skinned as Windows 8 (With [Echelon 140](https://github.com/nt5point1/echelon-140) installed)
<p align="center">
  <img width="1440" height="900" alt="Nocturne on Windows 10 skinned as Windows 8 with Echelon" src="./docs/readme/Nocturne_Echelon_Win10to8.png" />
</p>

<hr />

#### Nocturne on Windows 10 skinned as Windows XP (With [Namoroka](https://github.com/echelon-theme/namoroka) installed)
<p align="center">
  <img width="1440" height="900" alt="Nocturne on Windows 10 skinned as Windows XP with Namoroka" src="./docs/readme/Nocturne_Namoroka_Win10toXP.png" />
</p>

## Features

Nocturne keeps the browser feeling familiar while adding Windows-focused polish and compatibility:

- More native-like controls, scrollbars, checkboxes, radio buttons, and tooltips
- Aero Glass support on Windows 8/10+
- Full portable mode that doesn't touch AppData
- Switchable classic about:config page via `nocturne.ui.oldaboutconfig`
- Less telemetry than regular Firefox
- No background tasks
- Firefox 68-style retry button for failed downloads via `nocturne.ui.ff68downloadicons`
- JPEG XL support
- GPU/hardware acceleration in VMware Workstation 16 and above
- `general.useragent.override.(website)` is back
- Instant one-off searches
- Ability to disable CSP
- Ability to visit websites on ports that Firefox rejects
- Ability to revert icons to the legacy behavior via `nocturne.legacyiconbehavior.enabled`
- Ability to bring back the 16x16 icon via `nocturne.smalliconbehavior.enabled`
- Reimplemented `-moz-win-glass` for a glass look with borders
- Reimplemented the old URL search bar for pre-133 themes

and more!

## Credits

If I've forgotten to put your name here, please let me know and I'll add it.

- [Travis](https://github.com/travy-patty), [NetworkNeighborhood](https://github.com/NetworkNeighborhood/) - The current logo used in the browser. Recolored from the original.
- [Nareny](https://github.com/nt5point1/) - Modified the icon for Incognito, made the .pdf icon and helped with the new icon redesign.
- [Aubymori](https://github.com/aubymori/) & [Isabella Lulamoon](https://github.com/kawapure) - Classic about:config, disabled launcher process, and more from Nara browser
- [Erizur](https://github.com/Erizur/) - Improved native titlebar, modern mode, and some miscellaneous fixes from Marble Browser
- [Isabella Lulamoon](https://github.com/kawapure) - Native Controls Patch
- [Feodor2](https://github.com/Feodor2/) - Portable mode and Vista compatibility changes from Mypal68
- [goodusername123](https://github.com/goodusername123/) - Graphical acceleration in VMware Workstation
- [i486](https://github.com/i486/) - Fixed non-native menus
- [leadweedy](https://github.com/leadweedy) - Improved active tab indicator from Firefox-Proton-Square
- [bbc-chi](https://github.com/bbc-chi/) - Fullscreen transition fix
- [Alex313031](https://github.com/Alex313031/) - Mozconfig, general help with the browser, and changes from Mercury browser
- [newbie-461](https://github.com/newbie-461/) - Fixed the installer issues
- [SashaXser](https://github.com/SashaXser/) - Improved rustflags opts in mozconfig
- [Librewolf Developers](https://librewolf.net/) - Privacy tweaks from Librewolf
- [Mozilla Developers](https://www.firefox.com/) - Firefox browser base
- [Tor Browser Developers](https://www.torproject.org/) - Addon fix code from Tor Browser
- wanderer - Various code contributions for Vista support / extra help in Nocturne

# Original repository readme

![Firefox Browser](./docs/readme/readme-banner.svg)

[Firefox](https://firefox.com/) is a fast, reliable and private web browser from the non-profit [Mozilla organization](https://mozilla.org/).

### Contributing

To learn how to contribute to Firefox read the [Firefox Contributors' Quick Reference document](https://firefox-source-docs.mozilla.org/contributing/contribution_quickref.html).

We use [bugzilla.mozilla.org](https://bugzilla.mozilla.org/) as our issue tracker, please file bugs there.

### Resources

* [Firefox Source Docs](https://firefox-source-docs.mozilla.org/) is our primary documentation repository
* Nightly development builds can be downloaded from [Firefox Nightly page](https://www.mozilla.org/firefox/channel/desktop/#nightly)

If you have a question about developing Firefox, and can't find the solution
on [Firefox Source Docs](https://firefox-source-docs.mozilla.org/), you can try asking your question on Matrix at
chat.mozilla.org in the [Introduction channel](https://chat.mozilla.org/#/room/#introduction:mozilla.org).
