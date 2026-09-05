import AuthenticationServices
import Foundation
import Security
import UIKit

struct CurbnoteAccount: Codable, Sendable { let id: String; let name: String }
struct AccountSession: Decodable, Sendable { let account: CurbnoteAccount?; let token: String? }
struct AccountOK: Decodable, Sendable { let ok: Bool?; let id: String? }
struct SavedWalk: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let origin: Place
    let destination: Place
    let via: Place?
    let filters: [String]
}
struct SavedWalksResponse: Decodable, Sendable { let walks: [SavedWalk] }
struct PasskeyOptions: Decodable, Sendable {
    struct Options: Decodable, Sendable {
        struct User: Decodable, Sendable { let id: String; let name: String }
        let challenge: String
        let user: User?
    }
    let flow: String
    let options: Options
}

extension Data {
    var base64url: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    init?(base64url: String) {
        var value = base64url.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        value += String(repeating: "=", count: (4 - value.count % 4) % 4)
        self.init(base64Encoded: value)
    }
}

@MainActor
enum AccountKeychain {
    static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.curbnote.account", kSecAttrAccount as String: "session"]
    static func read() -> String? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func save(_ token: String?) throws {
        SecItemDelete(query as CFDictionary)
        guard let token else { return }
        var q = query; q[kSecValueData as String] = Data(token.utf8); q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(q as CFDictionary, nil) == errSecSuccess else { throw APIError("Could not securely keep your sign-in. Please retry.") }
    }
}

@MainActor
final class AccountModel: NSObject, ObservableObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    @Published var account: CurbnoteAccount?
    @Published var walks: [SavedWalk] = []
    @Published var busy = false
    @Published var message: String?
    private let api = APIClient()
    private var token = AccountKeychain.read()
    private var continuation: CheckedContinuation<Data, Error>?
    private var controller: ASAuthorizationController?

    func refresh() async {
        guard token != nil else { account = nil; walks = []; message = nil; return }
        do {
            let response: AccountSession = try await api.account("session", token: token)
            account = response.account
            if account != nil { let result: SavedWalksResponse = try await api.account("walks", token: token); walks = result.walks }
            else { token = nil; walks = []; try? AccountKeychain.save(nil) }
        } catch { message = error.localizedDescription }
    }
    func authenticate(kind: String, name: String = "Curbnote walker") async {
        guard !busy else { return }; busy = true; message = nil
        defer { busy = false }
        do {
            let options: PasskeyOptions = try await api.account("passkey/options", body: JSONSerialization.data(withJSONObject: ["kind":kind,"name":name]), token: token)
            guard let challenge = Data(base64url: options.options.challenge) else { throw APIError("Couldn't start sign-in.") }
            let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: "curbnote.polyfeeds.dev")
            let request: ASAuthorizationRequest
            if let user = options.options.user, let userID = Data(base64url: user.id) {
                let registration = provider.createCredentialRegistrationRequest(challenge: challenge, name: user.name, userID: userID)
                registration.userVerificationPreference = .required; request = registration
            } else {
                let assertion = provider.createCredentialAssertionRequest(challenge: challenge)
                assertion.userVerificationPreference = .required; request = assertion
            }
            let credential = try await withCheckedThrowingContinuation { (c: CheckedContinuation<Data, Error>) in
                continuation = c
                let controller = ASAuthorizationController(authorizationRequests: [request]); self.controller = controller
                controller.delegate = self; controller.presentationContextProvider = self; controller.performRequests()
            }
            let object = try JSONSerialization.jsonObject(with: credential)
            let response: AccountSession = try await api.account("passkey/verify", body: JSONSerialization.data(withJSONObject: ["flow":options.flow,"credential":object]), token: token)
            guard let newToken = response.token, response.account != nil else { throw APIError("Sign-in didn't complete.") }
            try AccountKeychain.save(newToken); token = newToken; account = response.account
            await refresh()
            message = kind == "add" ? "Additional passkey saved." : "Signed in. Choose Save walk to sync these addresses."
        } catch let error as ASAuthorizationError where error.code == .canceled { message = "Sign-in canceled. You can keep walking without an account." }
        catch { message = error.localizedDescription }
    }
    func save(_ walk: LocalWalk, name: String) async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            struct Request: Encodable { let name: String; let origin: Place; let destination: Place; let via: Place?; let filters: [String]; let consent = true }
            let _: AccountOK = try await api.account("walks", body: JSONEncoder().encode(Request(name: name, origin: walk.origin, destination: walk.destination, via: walk.via, filters: walk.filters)), token: token)
            await refresh(); message = "Walk saved across your devices."
        } catch { message = error.localizedDescription }
    }
    func remove(_ walk: SavedWalk) async {
        do { let _: AccountOK = try await api.account("walks/remove", body: JSONSerialization.data(withJSONObject: ["id":walk.id]), token: token); await refresh() }
        catch { message = error.localizedDescription }
    }
    func logout() async {
        do { let _: AccountOK = try await api.account("logout", body: Data("{}".utf8), token: token) }
        catch { message = "Signed out on this phone. The server session will expire automatically." }
        token = nil; account = nil; walks = []; try? AccountKeychain.save(nil)
    }
    func deleteAccount() async {
        do {
            let _: AccountOK = try await api.account("delete", body: Data(#"{"confirm":true}"#.utf8), token: token)
            token = nil; account = nil; walks = []; try? AccountKeychain.save(nil); message = "Account and synced walks deleted."
        } catch { message = error.localizedDescription }
    }
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let c = continuation; continuation = nil; self.controller = nil; c?.resume(throwing: error)
    }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        var object: [String: Any]
        if let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration, let attestation = credential.rawAttestationObject {
            object = ["id":credential.credentialID.base64url,"rawId":credential.credentialID.base64url,"type":"public-key","response":["clientDataJSON":credential.rawClientDataJSON.base64url,"attestationObject":attestation.base64url,"transports":["internal","hybrid"]],"clientExtensionResults":[:]]
        } else if let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion {
            object = ["id":credential.credentialID.base64url,"rawId":credential.credentialID.base64url,"type":"public-key","response":["clientDataJSON":credential.rawClientDataJSON.base64url,"authenticatorData":credential.rawAuthenticatorData.base64url,"signature":credential.signature.base64url,"userHandle":credential.userID.base64url],"clientExtensionResults":[:]]
        } else { authorizationController(controller: controller, didCompleteWithError: APIError("Unsupported sign-in response.")); return }
        let c = continuation; continuation = nil; self.controller = nil
        do { c?.resume(returning: try JSONSerialization.data(withJSONObject: object)) } catch { c?.resume(throwing: error) }
    }
}
