# SayScore brand assets — where they go

Vite serves everything in `frontend/public/` at the site root. Place files like this:

```
frontend/public/
├── favicon.ico
├── og-image.png
├── site.webmanifest
└── icons/
    ├── favicon.svg
    ├── favicon-16.png
    ├── favicon-32.png
    ├── favicon-48.png
    ├── apple-touch-icon.png
    ├── icon-192.png
    ├── icon-512.png
    └── icon-512-maskable.png
```

Then paste the contents of `head-snippet.html` into `frontend/index.html` inside `<head>`.

Logos (for the app UI — header, login screen) live with the source, e.g. `frontend/src/assets/`:
- `sayscore-logo-dark.png`        — header/login on the dark app background
- `sayscore-logo-transparent.png` — works on any background (dark or light)
- `sayscore-logo-light.png`       — for white/light surfaces (e.g. printed or email)
- `sayone-wordmark-transparent.png` — wordmark only, no product name

## Colors used
- SayOne blue  `#3D83F5`
- Brand coral  `#E95145`
- App dark indigo `#141220`
