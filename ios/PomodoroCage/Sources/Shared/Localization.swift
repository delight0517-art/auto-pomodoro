import Foundation

enum AppLocalization {
  static let languagePreferenceKey = "pomodoro.appLanguage"
  static let systemLanguage = "system"

  /// Adding a localization to the String Catalog makes it available here automatically.
  static var availableLanguages: [String] {
    Bundle.main.localizations
      .filter { $0 != "Base" }
      .sorted()
  }

  static func displayName(for language: String) -> String {
    Locale(identifier: language).localizedString(forIdentifier: language) ?? language
  }

  static func locale(for selection: String) -> Locale {
    selection == systemLanguage ? .autoupdatingCurrent : Locale(identifier: selection)
  }

  static var currentLocale: Locale {
    locale(for: UserDefaults.standard.string(forKey: languagePreferenceKey) ?? systemLanguage)
  }

  static func formattedDate(_ date: Date, dateStyle: Date.FormatStyle.DateStyle = .abbreviated, timeStyle: Date.FormatStyle.TimeStyle = .shortened) -> String {
    date.formatted(Date.FormatStyle(date: dateStyle, time: timeStyle, locale: currentLocale))
  }

  static func selectedBundle() -> Bundle? {
    guard let language = UserDefaults.standard.string(forKey: languagePreferenceKey),
          language != systemLanguage,
          availableLanguages.contains(language),
          let path = Bundle.main.path(forResource: language, ofType: "lproj") else { return nil }
    return Bundle(path: path)
  }

  static func fallbackBundle() -> Bundle? {
    guard let path = Bundle.main.path(forResource: "ko", ofType: "lproj") else { return nil }
    return Bundle(path: path)
  }
}

// MARK: - 로컬라이제이션 헬퍼
//
// 2026-09-05 추가 — 앱 전체에 하드코딩된 한국어 문자열(153곳)을
// `Localizable.xcstrings`(Apple String Catalog, sourceLanguage="ko")로 옮기면서
// 동적 키를 지원하고 앱 내 언어 선택을 반영하는 짧은 래퍼.
//
// - `L(key, ko문구)`      → 단순 문자열
// - `LF(key, ko포맷, args)` → `%d`/`%@` 등 포맷 인자가 있는 문자열
//   (선택한 로케일의 포맷 문자열을 얻은 뒤 String(format:)으로 인자를 채운다 —
//   xcstrings의 문자열은 그대로 두고
//   인자만 나중에 채워 넣는 표준 패턴)
// `Bundle.localizedString(forKey:)` also supports keys assembled at runtime.
func L(_ key: String, _ defaultValue: String) -> String {
  guard let bundle = AppLocalization.selectedBundle() else {
    return Bundle.main.localizedString(forKey: key, value: defaultValue, table: nil)
  }
  let value = bundle.localizedString(forKey: key, value: nil, table: nil)
  guard value == key else { return value }
  return AppLocalization.fallbackBundle()?.localizedString(forKey: key, value: defaultValue, table: nil) ?? defaultValue
}

func LF(_ key: String, _ defaultValue: String, _ args: CVarArg...) -> String {
  String(format: L(key, defaultValue), locale: AppLocalization.currentLocale, arguments: args)
}
