---
name: design-review
description: Look at an idea's iOS or Android screens on a simulator or emulator, in light and dark and at large text, and judge them against a design checklist. Use when the user asks to review, polish or check the design, layout or look and feel of an app, or after changing a screen, before calling UI work done.
---

# Review an idea's design by looking at it

Layout, spacing and feel cannot be proven by `pnpm verify`. Claude can only judge them by
looking, so this skill is a loop: run the app, capture the screens, compare them with the
checklist, fix, look again. A passing build is not a design review.

## Ground rules

- **Use a device the user already has open or booted**, or ask which to boot. `labs-verify`
  (the iOS simulator and the Android AVD `emulator-5584`) belongs to `pnpm verify`: do not
  use, boot or shut it down for this.
- **Whatever you change on a device, restore it** (appearance, text size, window size). The
  device is the user's.
- Never edit the generated Xcode project: change `project.yml`. Warnings fail the build on
  both platforms, so fix them, do not suppress them.
- Read the screen first (`ContentView.swift`, `HomeScreen.kt` and what the idea added), and the
  idea's spec if there is one, so you know what the screen is for before judging how it looks.

## 1. Run it

Follow the `try-locally` skill for the backend, the local key and launching the app. Then
reach each screen the review covers, including its empty, loading, error and long-content
states. If a state cannot be reached, say so and read its `#Preview` / `@Preview` instead.

## 2. Capture

For each screen, capture all of these. Take the screenshot and actually look at it.

| Variant | iOS (simulator) | Android (emulator) |
|---|---|---|
| Light | `set_appearance` light, then `screenshot` | `adb shell cmd uimode night no`, then `adb exec-out screencap -p` |
| Dark | `set_appearance` dark | `adb shell cmd uimode night yes` |
| Largest text | `xcrun simctl ui <device> content_size accessibility-extra-extra-extra-large` | `adb shell settings put system font_scale 2.0` |
| Keyboard up (screens with input) | `set_keyboard` show | tap a field, then capture |

Use the simulator control tool for iOS screenshots and taps, and `adb` for Android. Then
restore: appearance and text size back to what they were (`content_size large` on iOS,
`font_scale 1.0` and `night no` on Android if you changed them).

The templates are iPhone, portrait only. Do not review landscape or iPad unless the idea's
`project.yml` or manifest enables them. On Android, note which screen sizes you could not
check on the device you had.

## 3. Judge against the checklist

Say what you see for each item, not just "looks fine".

- **Hierarchy:** one clear primary thing per screen, secondary things quieter, nothing competing.
- **Spacing:** a consistent rhythm; content not touching edges, notch, home indicator or system bars.
- **Type:** system styles (`.largeTitle`, `.body`, `MaterialTheme.typography.*`), not hard-coded sizes.
  At the largest text size nothing is clipped, overlapped or cut off: it wraps or scrolls.
- **Color:** system or theme colors (`.primary`, `.secondary`, `MaterialTheme.colorScheme.*`), no
  hard-coded hex that breaks in dark mode. Text is readable on its background in both modes.
- **Touch targets:** tappable things are at least 44pt (iOS) or 48dp (Android) and look tappable.
- **States:** empty, loading, error and a very long string each look intentional.
- **Accessibility:** controls have labels (`accessibilityLabel`, `contentDescription`); meaning is
  not carried by color alone; images that carry information have text alternatives.
- **Platform feel:** native components and behavior (navigation, sheets, back gesture, system
  back on Android), not a copy of the other platform's look.
- **Consistency across platforms:** the same idea reads as the same product. It should not look identical.
- **Calm:** no decoration that does not help the user; nothing blinking, crowded or shouting.

## 4. Fix and look again

Fix at the cause (a layout rule, a missing theme color), not by tuning a number until one
screenshot looks right. Capture the changed screens again in every variant, since a fix for
large text often breaks the default layout.

Where a state matters and nothing covers it, add a `#Preview` / `@Preview` for it so it can
be looked at again cheaply. If a check should never regress (a tag or identifier a UI test
relies on), put it in a test, not in this checklist.

## 5. Report

List per screen what you checked, what you changed, and what you did **not** check
(a state you could not reach, a device size you did not have, a screen you did not open).
Finish with `pnpm verify <idea>`: design fixes must not break the build, the lint or the tests.
