import Foundation
import Security

/// BlueCloud 로그인 자격 정보를 이 iPhone의 Keychain에만 저장한다. ThisDeviceOnly 설정으로
/// iCloud 백업/다른 기기에는 옮기지 않고, 앱 제거 후 재설치에는 남겨 자동 로그인을 복구한다.
enum PomodoroKeychainStore {
  private static let service = "com.rogan.pomodorocage.bluecloud"

  @discardableResult
  static func save(_ value: String, key: String) -> Bool {
    let data = Data(value.utf8)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
    ]
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]
    let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if updateStatus == errSecSuccess { return true }
    guard updateStatus == errSecItemNotFound else { return false }
    var newItem = query
    attributes.forEach { newItem[$0.key] = $0.value }
    return SecItemAdd(newItem as CFDictionary, nil) == errSecSuccess
  }

  static func read(key: String) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func delete(key: String) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
    ]
    SecItemDelete(query as CFDictionary)
  }
}
