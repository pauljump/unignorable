import SwiftUI

struct DirectionsView: View {
    @EnvironmentObject private var model: RouteModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            content
            .navigationTitle("Directions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder private var content: some View {
        if let route = model.selectedRoute, let steps = route.steps, !steps.isEmpty {
            List {
                Section {
                    HStack(alignment: .firstTextBaseline) {
                        Text(routeDuration(route.duration)).font(.title2.bold())
                        Text(routeDistance(route.distance)).foregroundStyle(.secondary)
                        Spacer()
                        if route.recommended { Text("BEST").font(.caption2.bold()).foregroundStyle(AppTheme.coral) }
                    }
                    if let via = model.via {
                        Label("Stop at \(via.name)", systemImage: "plus.circle.fill").font(.subheadline).foregroundStyle(AppTheme.mint)
                    }
                    Text(outcome(route)).font(.caption).foregroundStyle(.secondary)
                }

                if let routeExport = route.export {
                    Section("Open this walk") {
                        Link(destination: routeExport.apple) {
                            Label("Open in Apple Maps", systemImage: "apple.logo")
                                .font(.headline)
                                .foregroundStyle(AppTheme.coral)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        Link(destination: routeExport.google) {
                            Label("Open in Google Maps", systemImage: "map.fill")
                                .font(.headline)
                                .foregroundStyle(.blue)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }

                Section {
                    ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                        Button {
                            model.focus(step)
                        } label: {
                            HStack(alignment: .top, spacing: 13) {
                                Image(systemName: maneuverSymbol(step, index: index, count: steps.count))
                                    .font(.title3).foregroundStyle(AppTheme.coral).frame(width: 30)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(step.instruction).font(.body.weight(.medium)).foregroundStyle(.primary)
                                    Text(stepDistance(step.distance)).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.vertical, 5)
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("Key walking directions")
                } footer: {
                    Text("Small path and crosswalk offsets are folded into the highlighted route instead of shown as fake turns.")
                }

                Section {
                    Text("The route drawn in Unignorable is exact. Apple and Google receive the stop and shaping points but may refine the line.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        } else {
            ContentUnavailableView("Directions unavailable", systemImage: "point.topleft.down.to.point.bottomright.curvepath",
                                   description: Text("Try rebuilding the route. The map needs maneuver data before it can show turn-by-turn directions."))
        }
    }

    private func stepDistance(_ meters: Double) -> String {
        if meters < 402 { return "\(Int((meters * 3.28084).rounded())) ft" }
        return String(format: "%.1f mi", meters / 1609.344)
    }

    private func routeDuration(_ seconds: Double) -> String {
        let minutes = max(1, Int((seconds / 60).rounded()))
        return minutes >= 60 ? "\(minutes / 60) hr \(minutes % 60) min" : "\(minutes) min"
    }

    private func routeDistance(_ meters: Double) -> String {
        String(format: "%.1f mi", meters / 1609.344)
    }

    private func outcome(_ route: RouteChoice) -> String {
        guard !model.filters.isEmpty else { return "Fastest plausible route; no avoidance is selected." }
        if route.selectedIntersections == 0 { return "No high-confidence selected locations are crossed." }
        return "Cleanest reasonable route crosses \(route.selectedIntersections) high-confidence selected location\(route.selectedIntersections == 1 ? "" : "s")."
    }

    private func maneuverSymbol(_ step: RouteStep, index: Int, count: Int) -> String {
        let text = "\(step.type ?? "") \(step.modifier ?? "") \(step.instruction)".lowercased()
        if index == count - 1 || text.contains("arrive") || text.contains("destination") { return "mappin.circle.fill" }
        if text.contains("u-turn") || text.contains("uturn") { return "arrow.uturn.backward" }
        if text.contains("roundabout") || text.contains("rotary") { return "arrow.clockwise.circle.fill" }
        if text.contains("slight left") { return "arrow.up.left" }
        if text.contains("slight right") { return "arrow.up.right" }
        if text.contains("left") { return "arrow.turn.up.left" }
        if text.contains("right") { return "arrow.turn.up.right" }
        if text.contains("merge") { return "arrow.merge" }
        return "arrow.up"
    }
}
