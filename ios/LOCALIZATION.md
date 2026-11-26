# iOS language support

- User-visible strings live in `PomodoroCage/Resources/Localizable.xcstrings`.
- `L` and `LF` in `PomodoroCage/Sources/Shared/Localization.swift` are the only runtime lookup helpers. Keep UI copy out of raw Swift string literals.
- The supported app languages are `en`, `ja`, `ko`, and `zh-Hans`; every catalog key must have a translation in all four. To add a language, add its localization to the String Catalog, update `REQUIRED_LANGUAGES` in the checker and `LocalizationTests`, translate every key, then build and review each screen in that language.
- The Settings language picker reads languages from compiled `.lproj` resources. `system` follows the iPhone language. A manual choice is saved on this iPhone and is not sent to Mac/Windows.
- Every build runs `scripts/check-ios-localizations.py`. It checks exact supported-language coverage, missing or source-identical translations (with an explicit allowlist for language-neutral labels/format strings), Korean text leaking into non-Korean locales, runtime keys, visible raw SwiftUI strings across all source files, encoding corruption, and format placeholders. Run it directly for a quick check.
- For a new visible label, button, alert, empty state, accessibility label, or date/time, use `L`/`LF` and add a catalog value for each supported language in the same change. Keep user data such as timetable labels untranslated; localize only the surrounding UI.
- Adding a language is a catalog migration: update the supported-language set, translate every catalog entry, verify each locale has no untranslated source text or mixed-script leakage, and review the app's main screens in that language before release. Translation coverage alone does not prove translation quality.
- Synced schedule labels are user data, not translated UI strings. `DurationOverridesEngine` repairs legacy mojibake before displaying or applying them.
