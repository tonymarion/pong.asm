# Vinted Fit

A userscript that runs on `www.vinted.com` in your phone's browser (not the Vinted app) and adds:

- **Size filter** – listings that are confidently the wrong size are hidden. Sizes are set in Settings, nothing is fixed in code.
- **Brand tiers** – blocked brands and "too high end" brands are hidden; brands you like are boosted.
- **👍 / 👎 on every listing** – 👎 hides the item for good and asks why (condition, color, style, size, price, brand, or "just this one"). Only the reasons you pick count against future items, so a scruffy item from a brand you like doesn't hurt the brand.
- **Taste score** – a badge on each listing, learned from your votes plus favourites, offers and purchases you make on Vinted.
- **Feed** – everything you've scrolled past that fits, best match first, with shortcuts to the newest listings for each liked brand.
- **Closet and outfits** – add photos of what you own and combine them with Vinted items.

All data stays in the browser on your device. Use Settings → Export backup now and then.

## Install

**iPhone (Safari)**
1. Install the free **Userscripts** app from the App Store.
2. Open it and choose a folder for scripts; save `vinted-fit.user.js` into that folder (Files app).
3. Settings → Apps → Safari → Extensions → Userscripts → allow, and allow it on `vinted.com`.
4. Open `www.vinted.com` in Safari. If the phone tries to open the Vinted app, long-press the link and choose "Open in Safari".

**Android**
1. Install **Firefox**, then the **Violentmonkey** (or Tampermonkey) add-on.
2. Open the raw `vinted-fit.user.js` file in Firefox and confirm the install.
3. Open `www.vinted.com` in Firefox.

A black ✦ button appears bottom-right; it opens Feed, Outfits, Closet and Settings.

## Limits

- It only sees listings your browser loads; it makes no requests of its own, so there is no background alerting.
- It does not know when an item in an outfit has sold.
- Built and tested against a mock of Vinted's listing markup, not the live site. If buttons don't appear on listings, the card detection needs adjusting.
