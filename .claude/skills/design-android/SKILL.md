---
name: design-android
description: How to build and change screens in an idea's Android app (Jetpack Compose, Material 3) so they look native and pass this repo's checks. Use when adding or changing an Android screen or composable, choosing components, type, colors or layout, or fixing a Kotlin or Lint warning, before the design-review skill.
---

# Design Android screens in this repo

Start from what the template gives you: `apps/<idea>/android/app/src/main/kotlin/to/labs/idea/`
(`MainActivity.kt`, `Theme.kt` with `IdeaTheme`, `HomeScreen.kt`), Compose and Material 3,
edge to edge, `minSdk 26`. Look first with the `design-review` skill; this skill is how to build,
so that review has little to find.

## Repo rules that shape the code

- **Gradle is the source of truth.** Modules are `:app` (and `:backend`), the Kotlin package is
  `to.labs.idea`, versions are pinned in `gradle/libs.versions.toml`. Read the Decisions in
  `README.md` before bumping AGP, Gradle or Compose.
- **Kotlin and Android Lint warnings fail the build.** Fix them at the cause; do not add a
  `@Suppress` or relax `lint {}` or `allWarningsAsErrors`.
- **Formatting is kotlinter (ktlint)**, `ktlint_official`, 120 columns. Check with
  `cd apps/<idea>/android && ./gradlew lintKotlin`, fix with `./gradlew formatKotlin`.
  Composable functions are named like types (`HomeScreen`); the `.editorconfig` allows it.
- Per-machine values (the local key, a LAN address) go in the untracked `local.properties`.
  The real app identity (`applicationId`) comes from `idea.yaml`.
- Never run `gradlew --stop` or kill other Gradle daemons.

## Build native

- **Material 3 components first:** `Scaffold`, `TopAppBar`, `NavigationBar`, `LazyColumn`,
  `Button`, `OutlinedTextField`, `ModalBottomSheet`, `AlertDialog`, `CircularProgressIndicator`.
  A custom component needs a reason the Material one cannot do the job.
- **Text uses the theme:** `MaterialTheme.typography.headlineLarge`, `bodyLarge`, `labelMedium`,
  not `fontSize = 17.sp`. Sizes are in `sp` so they follow the user's font scale.
- **Color uses the scheme:** `MaterialTheme.colorScheme.primary`, `surface`, `onSurfaceVariant`.
  No hard-coded `Color(0x...)` in a screen; a new color goes in `Theme.kt`. `IdeaTheme` already
  follows dark mode and dynamic color (Android 12+); keep it that way and look at the fallback
  scheme too, since dynamic color changes what you see.
- **Edge to edge is on.** Handle insets: `safeDrawingPadding()`, `Scaffold` content padding,
  `WindowInsets`. Content must not sit under the status bar, gesture bar or keyboard.
- **Layout adapts:** `Modifier.weight`, `fillMaxWidth`, `LazyColumn` or `verticalScroll` where
  content can grow, no fixed heights on text. Think about narrow phones, large phones and the
  largest font scale. Use `WindowSizeClass` only if the idea really targets tablets or foldables.
- **Spacing is consistent:** reuse a few values (8, 12, 16, 24 dp).
- **Touch targets are at least 48 × 48 dp.** Material components already are; custom clickables
  need `Modifier.minimumInteractiveComponentSize()` or padding.
- **Navigation is the platform's:** system back and predictive back work. Do not intercept them
  without a reason.
- **Strings live in `res/values/strings.xml`** and are read with `stringResource`, so they can be
  translated and tested. (The template's placeholder text is not a pattern to copy.)

## Accessibility and testing hooks

- Every icon-only control and informative image has a `contentDescription`; decorative ones use
  `null`. Do not carry meaning by color alone. Group related text with `semantics`.
- Put `Modifier.testTag("...")` on elements a UI test needs (the template uses `"greeting"`). Tags
  are for tests, content descriptions are for people.
- Add a `@Preview` for each state a screen has (empty, loading, error, long text), wrapped in
  `IdeaTheme`, with dark (`uiMode = UI_MODE_NIGHT_YES`) and large-font (`fontScale = 2f`)
  variants where it matters. Previews are the cheapest way to look at a state again.

## Logic stays out of composables

Put decisions (formatting, validation, what to show) in plain Kotlin with JVM unit tests in
`src/test`, like `Greeting.kt` and `GreetingTest.kt`. Composables then only draw state.

## Before you call it done

1. Run the `design-review` skill on the screens you touched.
2. `pnpm verify <idea>`: it builds, runs lint and format, and the unit and instrumented tests.
