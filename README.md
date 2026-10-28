<p align="center">
  <img src="assets/brand/hero.png" width="180" height="180" alt="Universal Translator: pixel-art glasses and a ring, with speech becoming captions.">
</p>
<h1 align="center">Universal Translator</h1>
<p align="center">Follow the conversation. Find the words.</p>
<p align="center">
  <a href="https://github.com/lejlot/prod-universal-translator/actions/workflows/ci.yml"><img src="https://github.com/lejlot/prod-universal-translator/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
</p>
<p align="center"><a href="https://github.com/lejlot/prod-universal-translator/tree/v0.3.2"><strong>v0.3.2</strong></a> · Even Realities G2 · Live translation · Suggested replies</p>

## What it does

- Follow a conversation in your chosen main language through your glasses.
- Get suggested replies with meanings in your main language.
- Long-press to translate your own speech back into the speaker’s language.
- While paused, long-press for a spoken Claude conversation that keeps its history until you stop.
- Control the app from your phone and see a live mirror of the glasses display.

<p align="center"><img src="assets/brand/flow.png" width="480" height="230" alt="Audio travels from G2 through the Even app to Soniox. Recent conversation text goes to Claude. Captions and suggested replies return to the glasses."></p>

## Get started

1. Install the app package through the Even app. Requires G2 glasses and Even app **2.2.10** or later.
2. Enter your Soniox and Anthropic API keys in Settings, then use **Check** to validate them.
3. Choose your main language, default source language and microphone. Add a Soniox organization key only if you want to see your prepaid balance.

## Controls

Click means **yes / confirm**, press means **listen**, double-click means **no / stop / exit**, and scrolling moves through the text.

| State | Click | Double-click | Press |
| --- | --- | --- | --- |
| Translating | Show replies | Pause | Listen and translate your speech |
| Paused | Resume translation | Close the app | Listen for a Claude conversation |
| Listening to your speech | Submit the utterance | Stop; in Claude, close the app | Keep listening |
| Claude answering | Wait for the answer | Close the app | Listen to a new question, cancelling the pending answer |
| Reverse translation result | Accept and resume captions | Pause | Listen again |
| Voice error | Listen again | Stop; in Claude, close the app | Listen again |

Long-press starts listening; click or a speech pause submits the utterance. Scroll to read the entire answer. Claude answers appear on the glasses and phone. The conversation keeps all turns until stopped.

Claude mode uses the glasses microphone and accepts only audio classified as the wearer by the Even app. Other and unidentified voices are muted before recognition. Speaker classification depends on the host; it is not voice identity authentication. Double-tap clears the conversation and opens the host's close flow.

## Build

Requires **Node.js 24**.

```sh
npm ci
npm run pack
```

Creates `universal-translator.ehpk`. For a browser build and preview:

```sh
npm run build
npm run preview
```

## Privacy & services

Audio is sent to Soniox for speech recognition and translation. Recent conversation text is sent to Anthropic to prepare reply suggestions. Voice translation sends the captured utterance; Claude voice mode sends the current session history, languages, time and time zone. Optional current location sharing is configurable and requested only during Claude conversations. Location and Claude history are kept in memory and cleared when you stop. Your API keys are stored by the Even app on your phone. Service accounts and usage charges are separate.

## Checks

[CI](https://github.com/lejlot/prod-universal-translator/actions/workflows/ci.yml) type-checks the app, builds and validates the package, and scans source for secrets on pushes and pull requests.
