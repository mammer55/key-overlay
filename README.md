# Key Overlay

A customisable on-screen keyboard bookmarklet for Safari on iPhone. Tap any button in the overlay to fire real `KeyboardEvent` keydown/keyup events into the page underneath — perfect for browser games and web apps that expect keyboard input.

No app store, no build step, no backend. One JavaScript file on GitHub Pages + one bookmark.

---

## Setup

### 1 — Create the repo and enable GitHub Pages

1. Create a new GitHub repository.
2. Upload `overlay.js` and `index.html` to the `main` branch root.
3. Go to **Settings → Pages**, set Source to *Deploy from a branch*, choose **main / (root)**, and click **Save**.
4. Wait ~60 seconds. Your script will be live at:

   ```
   https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO_NAME/overlay.js
   ```

### 2 — The bookmarklet URL

Replace the two placeholders and save the following as a bookmark URL:

```
javascript:(function(){var s=document.createElement('script');s.src='https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO_NAME/overlay.js?t='+Date.now();document.head.appendChild(s);})();
```

The `?t=…` timestamp prevents the browser from serving a cached copy of the script.

### 3 — Save the bookmarklet on iPhone Safari

1. Open **any webpage** in Safari on your iPhone.
2. Tap the **Share** button → **Add Bookmark** → **Save**.
3. Open **Bookmarks** → find the bookmark you just saved → tap **Edit**.
4. Clear the URL field, paste the full `javascript:…` string above, and tap **Done**.

> **Tip:** AirDrop or iMessage the bookmarklet URL from your Mac so you don't have to type it on the phone.

---

## Usage

1. Navigate to the game or web app you want to control.
2. Open Bookmarks and tap the bookmarklet. A semi-transparent control bar appears at the top of the screen.
3. Tap **+** to add a button. Enter a key name (e.g. `ArrowUp`, `w`, `Space`) and optionally edit the display label. Tap **Add**.
4. The overlay enters Edit mode automatically — drag the new button where you want it.
5. Tap **Done** to lock the layout. Buttons are now tap-to-fire.

Your layout is saved to `localStorage` per hostname. The next time you fire the bookmarklet on the same site, your buttons are restored automatically.

### Control bar

| Button | Action |
|--------|--------|
| **✕** | Remove the overlay from the page |
| **Edit** | Enter edit mode (drag/delete buttons) |
| **+** | Open the add-button dialog |

### Edit mode

- Drag buttons anywhere on screen.
- Tap the red **✕** badge on any button to delete it.
- Tap **Done** to save and exit edit mode.

---

## Supported key names

| You type | Key fired |
|----------|-----------|
| `w`, `a`, `s`, `d`, `1`…`0` | that character |
| `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight` | arrow keys |
| `up`, `down`, `left`, `right` | arrow keys (shorthand) |
| `Space` or `space` | spacebar |
| `Enter` or `enter` | Enter |
| `Shift` or `shift` | Shift |
| `Escape`, `esc` | Escape |
| `Control`, `ctrl` | Control |
| `Alt` or `alt` | Alt |
| `Backspace` or `backspace` | Backspace |
| `Tab` or `tab` | Tab |
| `Delete`, `del` | Delete |

---

## Troubleshooting

**Overlay doesn't appear**  
The site may have a strict Content Security Policy that blocks dynamic script injection. This is a fundamental browser security limit; bookmarklet injection cannot work around it.

**Key presses are ignored by the game**  
Tap the game canvas directly to focus it, then use the overlay buttons. Some games only listen for keyboard events on a focused element.

**Buttons end up in odd positions after rotating the device**  
Enter Edit mode, rearrange the buttons, then tap Done to resave.

**Want to clear the saved layout for a site**  
Open the browser console (if available) and run:
```js
localStorage.removeItem('keyOverlay_v1_' + location.hostname);
```
Then re-fire the bookmarklet.

---

## How it works

`overlay.js` is a self-contained IIFE that:

1. Injects a fixed-position UI layer (`pointer-events: none` root so the page stays interactive everywhere except overlay buttons).
2. On **touchstart**: dispatches `keydown` on the canvas, any same-origin iframe body, `document.activeElement`, and `document`, with correct `.key`, `.code`, `.keyCode`, and `.which` values.
3. Holds a `setInterval` while the touch is held to repeat `keydown` at 50 ms (like a held key).
4. On **touchend**: clears the interval and dispatches `keyup`.
5. Persists button layout to `localStorage` keyed by hostname so each site has its own layout.
