# Hispanic Family Feud

A projector game board for **Hispanic Family Feud**, hosted by **S.A.L.S.A.** (Student Alliance for Learning, Success and Achievement) at Kutztown University.

It is a static site: plain HTML, CSS and JavaScript with no build step and no backend. It deploys to GitHub Pages as-is.

> **The questions in `questions.json` are placeholder data.** Replace them with your own survey results before the event. See [Editing questions](#editing-questions).

## Use this for your own event

1. **Fork** this repo on GitHub (or copy the folder).
2. Edit [`assets/js/config.js`](assets/js/config.js): your game name, organization and venue, and a unique `topicPrefix` for the remote buzzer. Every page picks these up.
3. Replace the placeholder questions: use the Question Editor, click **Export JSON**, and commit the file over `questions.json`.
4. Turn on **Settings → Pages** (see [Deploy](#deploy-to-github-pages)). Your game is live at `https://<you>.github.io/<repo>/host.html`.
5. **Deploy at least 15 minutes before the event.** Browsers cache scripts for about 10 minutes, so a late push can leave one device with a mix of old and new files.

## Pages

| Page | Who sees it | What it does |
|------|-------------|--------------|
| `index.html` | Audience, on the projector | The board, scores, bank, strikes, question and callouts. No controls. |
| `host.html` | Host, on the laptop | Every control, plus every answer and point value, including hidden ones. |
| `buzzer.html` | Face-off players, on a phone or iPad | Two big buttons, one per family. Joins the host with a room code. |
| `editor.html` | Organizers | Add, edit, reorder, select and delete questions. Import and export JSON. |

## Run it locally

ES modules and `fetch` don't work from `file://`, so serve the folder:

```sh
cd hispanic-family-feud
python3 -m http.server 8000
```

Then open `http://localhost:8000/host.html`.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository (the files sit at the repo root).
2. In the repo, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
4. After a minute the site is live at `https://<user>.github.io/<repo>/host.html`.

The empty `.nojekyll` file tells Pages to serve the files untouched.

## Game-day setup

1. Plug the laptop into the projector and set the displays to **extend**, not mirror.
2. Open `host.html` in Chrome, Edge, Firefox or Safari.
3. Click **Open Display Window**. Drag that window onto the projector and double-click it, or press **F**, for full screen.
4. Fill in the two families, captains and players, then click **Start Game**.

Both windows must run in the **same browser on the same computer**. They talk through `BroadcastChannel`, with a `localStorage` fallback.

**Sound** plays from the host window, so it comes out of whatever the laptop's audio is routed to (usually the projector or the room speakers over HDMI). All sounds are generated with the Web Audio API. Use the mute button or volume slider in the top bar.

**Soundboard.** The collapsible Soundboard panel at the top of the host console lets you load your own audio files:

- **Game sounds**: replace any built-in sound (correct answer, strike, buzz-in, steal, round win, winner, reveal remaining, timer end). Click **▶ Test** to preview, and **Use built-in** to go back.
- **Pads**: six free buttons for things like intro music or applause. Type in the box under a pad to rename it; names are saved in the browser. Fire a pad by clicking it, by pressing `1`–`6` while the Soundboard panel is open, or with `Shift`+`1`–`6` any time. A yellow badge shows while number keys are on pads; close the panel to use them for answers again. **Stop all sounds** (or `Esc`) cuts anything playing.
- Files are stored in that browser's IndexedDB on that computer only. They are never uploaded and never committed, so load them on the event laptop. MP3, WAV, M4A and OGG work; the limit is 40 MB per file.
- You are responsible for having the rights to any audio you load.

**Refreshing is safe.** The game is saved in the browser after every action, so a refresh of either window picks up where it left off.

## Remote buzzer

For the face-off, the host can hand players a phone or iPad with two big buttons, one per family.

1. On the host console, click **📱 Remote Buzzer**. A 4-character room code appears.
2. On the phone or iPad, open `buzzer.html` (or tap **Copy link** on the host and send it) and enter the code.
3. The buttons light up once the question is on screen and the face-off is waiting for a buzz. The first tap locks the other button, and the host registers that family exactly as if you had pressed `←` or `→`. **Undo** re-arms the buttons.

How it works and what to know:

- **Fair order.** Both buttons are on the same device, so that one device decides who touched first. Network delay isn't part of the comparison. Put both players on one device; with one device each, lag would decide close calls.
- **Transport.** The host and buzzer meet on a free public MQTT broker (EMQX, with HiveMQ as backup) over secure WebSocket, using the room code as the topic. There is no account and no server of ours. It works on campus Wi-Fi, where a direct device-to-device (WebRTC) link did not.
- **It needs the internet** on both devices, and the broker is a third-party service that could be down. The `←` / `→` keys always work as a fallback.
- **The room is public.** Anyone who guessed the code could send a buzz. Codes are random and the only thing a buzz does is mark who was first.
- **Reloading the host page closes the room** and gives a new code; **Close room** does the same.
- **Troubleshooting.** Add `&debug` to the buzzer address to show a small progress line at the bottom (`broker ok → host answered`). If a phone sticks on "Connecting to host…", read that line first. Open the page in a private tab if it looks stale (browsers cache scripts for about 10 minutes).
- Broker addresses and the topic prefix live in `assets/js/config.js`. The MQTT library is bundled in `assets/vendor/`, so no CDN is needed.
- The host and projector display still need to be in the same browser on the same computer; only the buzzer travels over the network.

## Running the game

The host console walks through each step and shows a hint under the answer buttons. Keyboard shortcuts make it fast:

| Key | Action |
|-----|--------|
| `Q` | Put the question on screen |
| `←` / `→` | Left / right family buzzed in first |
| `1`–`8` | Pick answer N (face-off guess, reveal, steal answer, or show-only after the round) |
| `X` | Not on board / strike / steal fails |
| `P` / `O` | Play / pass |
| `S` | Start the steal early |
| `T` | Start the huddle timer |
| `R` | Reveal remaining answers (no points) |
| `N` | Next round, or the winner screen after the last round |
| `U` or `Ctrl/Cmd+Z` | Undo |
| `M` | Mute |
| `1`–`6` with the Soundboard open, or `Shift`+`1`–`6` any time | Fire soundboard pad |
| `Esc` | Stop all soundboard sounds |

**Undo** keeps a full history, so any mistake can be stepped back, including a whole round.

**Manual overrides** (right-hand panel) set either score, the bank and the strikes. They can also award the bank to a family, give a family the face-off win, swap in a spare question, or end the game early. Every override can be undone.

**Reset Game** asks for confirmation, then clears scores and history. Team names stay filled in.

### Rules as implemented

- **Face-off.** Round 1 starts with the captains. Each later round rotates to the next member of each family. If the first answer is #1, that family wins control. If it's on the board but not #1, the other player guesses, and the higher-ranked answer wins; a miss gives control to the first family. If both miss, the families alternate through their members until someone hits the board. Face-off answers stay revealed and their points go into the bank.
- **Play or pass.** The face-off winner picks. The playing family goes down the line, one answer per player.
- **Points.** Each revealed answer adds its points times the round multiplier to the bank. Defaults are ×1, ×2, ×3, then ×3 for every later round. Change them on the setup screen.
- **Clearing the board** before 3 strikes wins the bank.
- **The steal.** On the 3rd strike the other family huddles (an optional 20-second timer) and their captain gives one answer. On the board: they win the whole bank plus that answer. Not on board: one X, and the bank goes to the playing family.
- **After the round**, Reveal Remaining flips the leftover tiles with no points.
- **After the final round**, the display shows the winner with confetti.

## Editing questions

Open `editor.html` (there's a link in the host console).

- Edits save automatically in this browser, and the host console uses them right away.
- The list order is the play order. Unchecked questions are skipped. Extra checked questions become spares the host can swap in.
- Each question needs 3 to 8 answers. Keep each question's points at 100 or less, sorted high to low. The editor flags problems, and **Sort high → low** fixes the order.
- **Export JSON** downloads `questions.json`. Commit it to the repo root to make it the default on every computer.
- **Import JSON** loads a file. **Revert to questions.json** throws away this browser's edits.

### File format

```json
{
  "questions": [
    {
      "id": "q1",
      "question": "Name a food that's always at a Hispanic family party.",
      "answers": [
        { "text": "Tamales", "points": 32 },
        { "text": "Empanadas", "points": 20 },
        { "text": "Pernil", "points": 12 }
      ]
    }
  ]
}
```

Optional fields: `"use": false` skips a question, and `"placeholder": true` marks sample data.

## Project layout

```
index.html  host.html  buzzer.html  editor.html  questions.json
assets/css/   common, display, host, editor, buzzer styles
assets/vendor/ bundled third-party libraries (MQTT.js)
assets/js/    config.js (branding and buzzer settings), state.js (rules engine), sync.js,
              remote.js, host-remote.js and buzzer.js (remote buzzer), host-soundboard.js, audio.js, questions.js,
              display.js, host.js, editor.js, papel.js, confetti.js, ui.js,
              soundboard.js (host-loaded audio files, IndexedDB)
tests/        engine.test.mjs, buzzer.test.mjs
```

## Tests

The rules engine has no DOM dependencies and is tested with Node's built-in runner:

```sh
node --test tests/*.test.mjs
```

## Credits and assets

The visual style, papel picado banner, sounds and confetti are original to this project. No Family Feud logos, fonts or audio are used. Fonts are Bungee and Archivo from Google Fonts, both under the SIL Open Font License, with system fallbacks if the network is down.
