<span style="display:block;text-align:center">![raytek Nocturne](./docs/readme/nocturne_banner.png)</span>

Nocturne is a fork of firefox that restores various removed customization options from older releases of Firefox, keeps Windows 7 and 8 support alive thanks to [Firefox-for-Windows-7](https://github.com/e3kskoy7wqk/Firefox-for-windows-7-REWORK) patches, and targets customized Windows 10/11 builds.

([Local (GitHub) Downloads](https://github.com/raytek-cafe/nocturne)): [![Github All Releases](https://img.shields.io/github/downloads/raytek-cafe/nocturne/total.svg)]()

## Features

More native and native like elements, scrollbar, checkboxes, radio buttons, tooltips, and more! Better than the 115 ESR patch!

Aero Glass or accent color on 8/10+!

Ability to use modern (Windows 10) theme on any OS!

Full portable mode that doesn't touch AppData at all!

Switchable Classic about:config page! (via browser.ui.oldaboutconfig)

Less telemetry than regular Firefox!

No background tasks!

Easier to notice red retry button for failed downloads!

JPEG XL support!

GPU/hardware acceleration in VMware Workstation 16 and above!

general.useragent.override.(website) is back!

Instant one off searches!

Ability to disable CSP!

Ability to visit websites on ports that Firefox rejects!

Ability to disable e10s! (Experimental and kinda broken)

Ability to revert the icons to use the legacy way (nocturne.legacyiconbehavior.enabled)

Ability to bring back the 16x16 icon back (nocturne.smalliconbehavior.enabled)

Reimplemented -moz-win-glass for a glass look with borders

## Credits

If I've forgotten to put your name here, please let me know and I'll add it.

Travis, NetworkNeighborhood - The current logo used in the browser. Recolored from the original.

Nareny - Modified the icon for Incognito, made the .pdf icon and helped with the new icon redesign.

e3kskoy7wqk - Firefox for Windows 7 patches to make Nocturne work on Windows 8.1 and lower.

Alex313031 - Mozconfig, general help with the browser, and changes from Mercury browser

aubymori & ephemeralviolette - Classic about:config, disabled launcher process, and more from Nara browser

bbc-chi - Fullscreen transition fix

Erizur - Improved native titlebar, modern mode and some misc fixes from Marble browser

K4sum1 - J’ai repris certains patchs que je ne savais pas comment améliorer, ou qui ne contenaient tout simplement rien que je puisse améliorer, puisque je m’étais à l’origine basé sur leur branche forkée.

Feodor2 - Portable mode and Vista compatibility changes from Mypal68

MrAlex94/Waterfox - Some patches and some commits for XUL extensions.

goodusername123 - Graphical acceleration in VMware Workstation

i486 - Fixed non-native menus

kawapure & ephemeralviolette - Native Controls Patch

leadweedy - Improved active tab indicator from Firefox-Proton-Square

Librewolf Developers - Privacy tweaks from Librewolf

Mozilla Developers - Firefox browser base

newbie-461 - Fixed the installer issues

SashaXser - Improved rustflags opts in mozconfig

Solinus - Branding visuals, icons and fancy text

Tor Browser Developers - Addon fix code from Tor Browser

Unity Pixelheart (UnityAI) - General help with coding and the theme code (Created by @GarryStraitYT)

wanderer - Various code contributions for Vista support/Extra help in nocturne

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
