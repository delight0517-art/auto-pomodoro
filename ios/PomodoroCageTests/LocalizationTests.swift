import XCTest
@testable import PomodoroCage

final class LocalizationTests: XCTestCase {
  func testLanguageCanSwitchAndFallsBackToDeviceSetting() {
    let defaults = UserDefaults.standard
    let previous = defaults.string(forKey: AppLocalization.languagePreferenceKey)
    defer {
      if let previous { defaults.set(previous, forKey: AppLocalization.languagePreferenceKey) }
      else { defaults.removeObject(forKey: AppLocalization.languagePreferenceKey) }
    }

    defaults.set("en", forKey: AppLocalization.languagePreferenceKey)
    XCTAssertEqual(L("settings.language.title", "앱 표시 언어"), "App language")

    defaults.set("ja", forKey: AppLocalization.languagePreferenceKey)
    XCTAssertEqual(L("settings.language.title", "앱 표시 언어"), "アプリの言語")

    defaults.set(AppLocalization.systemLanguage, forKey: AppLocalization.languagePreferenceKey)
    XCTAssertNil(AppLocalization.selectedBundle())

    defaults.set("zh-Hans", forKey: AppLocalization.languagePreferenceKey)
    XCTAssertEqual(L("settings.language.title", "앱 표시 언어"), "应用语言")
  }

  func testLanguagesComeFromBundledLocalizations() {
    XCTAssertEqual(Set(AppLocalization.availableLanguages), ["en", "ja", "ko", "zh-Hans"])
  }
}
