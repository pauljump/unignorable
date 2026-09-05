import SwiftUI
import MapKit
import AVFoundation

@MainActor
private final class WalkingVoice: ObservableObject {
    private let speaker = AVSpeechSynthesizer()
    func read(_ text: String) {
        speaker.stopSpeaking(at: .immediate)
        let speech = AVSpeechUtterance(string: text)
        speech.voice = AVSpeechSynthesisVoice(language: "en-US")
        speaker.speak(speech)
    }
    func stop() { speaker.stopSpeaking(at: .immediate) }
}

struct DirectionsView: View {
    @EnvironmentObject private var model: RouteModel
    @Environment(\.dismiss) private var dismiss
    @StateObject private var voice = WalkingVoice()
    @State private var camera: MapCameraPosition = .automatic

    var body: some View {
        NavigationStack {
            if let route = model.selectedRoute, let steps = route.steps, !steps.isEmpty {
                let index = min(model.walkingStepIndex, steps.count - 1)
                let step = steps[index]
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack {
                            Text("\(max(1, Int((route.duration / 60).rounded()))) min · \(distance(route.distance))").font(.headline)
                            Spacer()
                            Text("Your planned walk").font(.caption).foregroundStyle(.secondary)
                        }
                        if let via = model.via { Label("Stop: \(via.name)", systemImage: "mappin.and.ellipse").font(.subheadline) }
                        Map(position: $camera, interactionModes: [.pan, .zoom]) {
                            MapPolyline(coordinates: route.geometry.mapCoordinates).stroke(AppTheme.brand, lineWidth: 6)
                            if let coordinate = step.location?.coordinate {
                                Annotation("Step \(index + 1)", coordinate: coordinate) {
                                    Text("\(index + 1)").font(.headline.bold()).padding(10)
                                        .foregroundStyle(AppTheme.background).background(AppTheme.brand, in: Circle())
                                }
                            }
                        }
                        .mapStyle(.standard(pointsOfInterest: .excludingAll))
                        .frame(height: 190).clipShape(RoundedRectangle(cornerRadius: 16))
                        .accessibilityIdentifier("walking-step-map")

                        VStack(alignment: .leading, spacing: 12) {
                            Text("Step \(index + 1) of \(steps.count)").font(.subheadline.bold()).foregroundStyle(AppTheme.brand)
                                .accessibilityIdentifier("walking-step-progress")
                            ProgressView(value: Double(index + 1), total: Double(steps.count)).tint(AppTheme.brand)
                            Label(step.instruction, systemImage: symbol(step))
                                .font(.title2.bold()).fixedSize(horizontal: false, vertical: true)
                                .accessibilityIdentifier("walking-step-instruction")
                            if step.distance > 0 { Text("Continue for \(distance(step.distance))").font(.headline) }
                            Text("Use Next as you reach each instruction.").font(.caption).foregroundStyle(.secondary)
                            HStack(spacing: 12) {
                                Button { model.selectWalkingStep(index - 1) } label: {
                                    HStack { Image(systemName: "chevron.left"); Text("Back") }
                                        .frame(maxWidth: .infinity, minHeight: 44)
                                        .background(AppTheme.raised, in: RoundedRectangle(cornerRadius: 10))
                                }
                                .disabled(index == 0).opacity(index == 0 ? 0.45 : 1)
                                .accessibilityIdentifier("walking-step-back")
                                Button { voice.read(step.instruction + (step.distance > 0 ? " Continue for \(distance(step.distance))." : "")) } label: {
                                    HStack { Image(systemName: "speaker.wave.2"); Text("Read step") }
                                        .frame(maxWidth: .infinity, minHeight: 44)
                                        .background(AppTheme.raised, in: RoundedRectangle(cornerRadius: 10))
                                }.accessibilityIdentifier("walking-step-read")
                            }.buttonStyle(.plain).foregroundStyle(AppTheme.brand)
                            Button {
                                if index == steps.count - 1 { dismiss() }
                                else { model.selectWalkingStep(index + 1) }
                            } label: {
                                Text(index == steps.count - 1 ? "Finish walk" : "Next instruction")
                                    .font(.headline).frame(maxWidth: .infinity, minHeight: 42)
                            }
                            .buttonStyle(.borderedProminent).tint(AppTheme.brand).foregroundStyle(AppTheme.background)
                            .accessibilityIdentifier("walking-step-next")
                            if index + 1 < steps.count {
                                Text("Then: \(steps[index + 1].instruction)").font(.subheadline).foregroundStyle(.secondary)
                            }
                        }.padding(16).background(AppTheme.panel, in: RoundedRectangle(cornerRadius: 16))

                        DisclosureGroup("All \(steps.count) instructions") {
                            ForEach(Array(steps.enumerated()), id: \.offset) { row, item in
                                Button { model.selectWalkingStep(row) } label: {
                                    HStack(alignment: .top) {
                                        Text("\(row + 1)").foregroundStyle(AppTheme.brand).frame(width: 28)
                                        Text(item.instruction).frame(maxWidth: .infinity, alignment: .leading)
                                        if item.distance > 0 { Text(distance(item.distance)).foregroundStyle(.secondary) }
                                    }.padding(.vertical, 8)
                                }.buttonStyle(.plain)
                            }
                        }
                        if let handoff = route.export {
                            DisclosureGroup("Plan separately in another map") {
                                Text("These apps calculate a new walk. Curbnote’s route and avoidance choices are not transferred.")
                                    .font(.caption).foregroundStyle(.secondary).padding(.vertical, 8)
                                if let legs = handoff.legs {
                                    ForEach(legs) { leg in
                                        Text(leg.name).font(.subheadline.bold()).padding(.top, 8)
                                        HStack {
                                            Link("Apple Maps", destination: leg.apple)
                                            Spacer()
                                            Link("Google Maps", destination: leg.google)
                                        }.padding(.vertical, 8)
                                    }
                                } else {
                                    Link("Apple Maps", destination: handoff.apple)
                                    Link("Google Maps", destination: handoff.google)
                                }
                            }
                        }
                    }.padding(16)
                }
                .background(AppTheme.background)
                .onAppear { focus(step) }
                .onChange(of: model.walkingStepIndex) { _, _ in voice.stop(); focus(steps[min(model.walkingStepIndex, steps.count - 1)]) }
                .navigationTitle("Walk with Curbnote")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            } else {
                ContentUnavailableView("Directions unavailable", systemImage: "map", description: Text("Rebuild the walk to load its instructions."))
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            }
        }
        .presentationDetents([.large])
        .onDisappear { voice.stop() }
    }

    private func focus(_ step: RouteStep) {
        guard let coordinate = step.location?.coordinate else { camera = .automatic; return }
        camera = .region(.init(center: coordinate, span: .init(latitudeDelta: 0.004, longitudeDelta: 0.004)))
    }
    private func distance(_ meters: Double) -> String {
        meters < 160 ? "\(max(1, Int((meters * 3.28084).rounded()))) ft" : String(format: "%.1f mi", meters / 1609.344)
    }
    private func symbol(_ step: RouteStep) -> String {
        let text = "\(step.type ?? "") \(step.modifier ?? "") \(step.instruction)".lowercased()
        if text.contains("arriv") { return "mappin.circle.fill" }
        if text.contains("stair") { return "figure.stairs" }
        if text.contains("u-turn") || text.contains("uturn") { return "arrow.uturn.backward" }
        if text.contains("left") { return "arrow.turn.up.left" }
        if text.contains("right") { return "arrow.turn.up.right" }
        return "arrow.up"
    }
}
