---
name: design-ios
description: How to build and change screens in an idea's iOS app (SwiftUI) so they look native and pass this repo's checks. Use when adding or changing an iOS screen or view, choosing components, fonts, colors or layout, or fixing a SwiftUI warning, before the design-review skill.
---

# Design iOS screens in this repo

Start from what the template gives you: `apps/<idea>/ios/Sources/` (`IdeaApp.swift`,
`ContentView.swift`), SwiftUI only, iPhone and portrait, iOS 18 minimum. Look first with the
`design-review` skill; this skill is how to build, so that review has little to find.

## Repo rules that shape the code

- **Edit `project.yml`, never the generated `Idea.xcodeproj`.** Regenerate with
  `pnpm ios <idea> generate`. Keep the target names `Idea`, `IdeaTests`, `IdeaUITests`.
- **Swift 6, warnings are errors.** Fix a warning at its cause (concurrency, unused value,
  deprecated API). Do not silence it or loosen a setting.
- **Formatting is `swift-format` in strict mode** with the idea's `.swift-format` (2 spaces,
  100 columns). Fix with
  `xcrun swift-format format --in-place --configuration apps/<idea>/ios/.swift-format <files>`.
- **iPhone portrait only** (`TARGETED_DEVICE_FAMILY "1"`, one orientation). Adding iPad or
  landscape is a deliberate change in `project.yml`, and then those layouts need a review too.
- Per-machine values (signing team, local key) go in the untracked `Config/Local.xcconfig`.
  The Release backend comes from `Config/Release.xcconfig`.

## Build native

- **System components first:** `NavigationStack`, `List`, `Form`, `TabView`, `Button`, `.sheet`,
  `.confirmationDialog`, `ProgressView`, `ContentUnavailableView` for empty and error states.
  A custom control needs a reason the system one cannot do the job.
- **Text uses styles:** `.font(.title)`, `.headline`, `.body`, `.caption`, not point sizes, so
  Dynamic Type works. If you must size something to text, use `@ScaledMetric`.
- **Color uses semantic values:** `.primary`, `.secondary`, `.tint`, `Color(.systemBackground)`,
  asset-catalog colors with light and dark variants. No hard-coded hex in a view. Dark mode must
  not need a second pass.
- **Layout adapts:** stacks, `Spacer`, `.frame(maxWidth: .infinity)`, `ViewThatFits` or
  `ScrollView` where content can grow. Respect the safe area (do not paint over it unless it is a
  background). Avoid fixed heights on anything that holds text.
- **Spacing is consistent:** pick a small set (for example 8, 12, 16, 24) and reuse it.
- **Tap targets are at least 44 × 44 pt.** Use `.contentShape(Rectangle())` or padding, not a
  tiny icon.
- **Navigation and gestures are the platform's:** the back swipe, swipe actions and pull to
  refresh work as users expect. Do not replace them.
- **Motion is light and respects Reduce Motion** (`@Environment(\.accessibilityReduceMotion)`).

## Accessibility and testing hooks

- Every control and meaningful image has a label (`.accessibilityLabel`); decorative images are
  hidden (`.accessibilityHidden(true)`). Do not carry meaning by color alone.
- Put `.accessibilityIdentifier("...")` on elements a UI test needs (the template does this with
  `"greeting"`). Identifiers are for tests, labels are for people: do not reuse one for the other.
- Add a `#Preview` for each state a screen has (empty, loading, error, long text), including a
  dark and a large-text variant where it matters:
  `.preferredColorScheme(.dark)`, `.dynamicTypeSize(.accessibility3)`. Previews are the cheapest
  way to look at a state again.

## Logic stays out of views

Put decisions (formatting, validation, what to show) in plain Swift types with unit tests in
`Tests/Unit`, like `Greeting.swift` and `GreetingTests.swift`. Views then only draw state.

## Before you call it done

1. Run the `design-review` skill on the screens you touched.
2. `pnpm verify <idea>`: it generates the project, lints, builds and runs the unit and UI tests.
