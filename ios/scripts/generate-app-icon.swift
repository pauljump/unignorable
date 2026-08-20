import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let size = 1024
let colorSpace = CGColorSpaceCreateDeviceRGB()
guard let context = CGContext(
    data: nil,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: size * 4,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
) else {
    fatalError("Unable to create the icon canvas")
}

func color(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat) -> CGColor {
    CGColor(colorSpace: colorSpace, components: [red / 255, green / 255, blue / 255, 1])!
}

let navy = color(8, 12, 20)
let raisedNavy = color(18, 25, 38)
let coral = color(255, 91, 72)
let warmWhite = color(255, 246, 235)

context.setFillColor(navy)
context.fill(CGRect(x: 0, y: 0, width: size, height: size))

// A quiet field gives the locator mark separation at small home-screen sizes.
context.setFillColor(raisedNavy)
context.fillEllipse(in: CGRect(x: 116, y: 116, width: 792, height: 792))

// The open U is both the product initial and a route arriving at a known place.
let route = CGMutablePath()
route.move(to: CGPoint(x: 274, y: 688))
route.addLine(to: CGPoint(x: 274, y: 440))
route.addCurve(
    to: CGPoint(x: 750, y: 440),
    control1: CGPoint(x: 274, y: 224),
    control2: CGPoint(x: 750, y: 224)
)
route.addLine(to: CGPoint(x: 750, y: 688))
context.addPath(route)
context.setStrokeColor(coral)
context.setLineWidth(104)
context.setLineCap(.round)
context.setLineJoin(.round)
context.strokePath()

// A target expresses the prediction thesis without suggesting live tracking.
context.setStrokeColor(warmWhite)
context.setLineWidth(30)
context.strokeEllipse(in: CGRect(x: 407, y: 567, width: 210, height: 210))
context.setFillColor(warmWhite)
context.fillEllipse(in: CGRect(x: 478, y: 638, width: 68, height: 68))

guard let image = context.makeImage() else {
    fatalError("Unable to render the icon")
}

let scriptURL = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
let outputURL = scriptURL
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("Unignorable/Sources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png")

guard let destination = CGImageDestinationCreateWithURL(
    outputURL as CFURL,
    UTType.png.identifier as CFString,
    1,
    nil
) else {
    fatalError("Unable to open the icon output")
}

CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else {
    fatalError("Unable to write the icon")
}

print(outputURL.path)
