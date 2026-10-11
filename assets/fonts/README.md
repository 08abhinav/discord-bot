# Fonts for the share cards

Two fonts are drawn into the share card image (`src/card.ts`), so they ship with the Worker:

- `JetBrainsMono-Bold.ttf`: JetBrains Mono 700, Latin subset. License: `OFL-jetbrains-mono.txt`.
- `IBMPlexSans-Medium.ttf`: IBM Plex Sans 500, Latin subset. License: `OFL-ibm-plex-sans.txt`.

Both are the Latin subsets published by [Fontsource](https://fontsource.org). The layout relies on JetBrains Mono being monospaced (every glyph is 0.6 em wide), so swapping that one for a proportional font needs changes in `src/card.ts`.
