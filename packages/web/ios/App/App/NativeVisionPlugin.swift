import Capacitor
import CoreImage
import CoreVideo
import ImageIO
import UIKit
import Vision
import VisionKit

@objc(NativeVisionPlugin)
public class NativeVisionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeVisionPlugin"
    public let jsName = "NativeVision"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "analyzeImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeBackground", returnType: CAPPluginReturnPromise)
    ]

    @objc func analyzeImage(_ call: CAPPluginCall) {
        guard let base64 = call.getString("base64"),
              let data = Data(base64Encoded: base64),
              let inputImage = UIImage(data: data),
              let normalizedImage = normalizedImage(from: inputImage),
              let cgImage = normalizedImage.cgImage else {
            call.reject("图片数据无效")
            return
        }

        let minArea = max(0.003, call.getDouble("minArea") ?? 0.003)
        let maxItems = max(1, min(24, call.getInt("maxItems") ?? 12))
        let orientation = CGImagePropertyOrientation.up

        Task {
            do {
                let analysis = try await self.detectBackgroundAnalysis(cgImage: cgImage, orientation: orientation, minArea: minArea, maxItems: maxItems)
                var liftedSubjects: [NativeVisionSubject] = []
                var subjects = mergeSubjects(
                    groups: [analysis.textureSubjects, analysis.foregroundSubjects, analysis.saliencySubjects],
                    maxItems: maxItems
                )
                if subjects.isEmpty {
                    liftedSubjects = await self.detectSubjectLiftSubjects(image: normalizedImage, minArea: minArea, maxItems: maxItems)
                    subjects = mergeSubjects(groups: [liftedSubjects], maxItems: maxItems)
                }
                let items = subjects.enumerated().map { offset, subject in
                    [
                        "id": subject.id,
                        "name": "物品 \(offset + 1)",
                        "rect": subject.rect.asJSObject(),
                        "confidence": subject.confidence,
                        "source": subject.source
                    ] as [String: Any]
                }
                NSLog(
                    "[NativeVision] subject=%d foreground=%d saliency=%d texture=%d merged=%d image=%dx%d",
                    liftedSubjects.count,
                    analysis.foregroundSubjects.count,
                    analysis.saliencySubjects.count,
                    analysis.textureSubjects.count,
                    subjects.count,
                    cgImage.width,
                    cgImage.height
                )

                let resolvedItems = items
                let debugPayload: [String: Any] = [
                    "subjectCount": liftedSubjects.count,
                    "foregroundCount": analysis.foregroundSubjects.count,
                    "saliencyCount": analysis.saliencySubjects.count,
                    "textureCount": analysis.textureSubjects.count,
                    "mergedCount": subjects.count
                ]
                await MainActor.run {
                    call.resolve([
                        "width": cgImage.width,
                        "height": cgImage.height,
                        "items": resolvedItems,
                        "debug": debugPayload
                    ])
                }
            } catch {
                await MainActor.run {
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc func removeBackground(_ call: CAPPluginCall) {
        guard let base64 = call.getString("base64"),
              let data = Data(base64Encoded: base64),
              let inputImage = UIImage(data: data),
              let normalizedImage = normalizedImage(from: inputImage),
              let cgImage = normalizedImage.cgImage else {
            call.reject("图片数据无效")
            return
        }

        guard #available(iOS 16.0, *) else {
            call.reject("当前系统不支持去背景，需要 iOS 16 或更新版本")
            return
        }

        Task {
            do {
                let result = try await self.removeBackgroundData(image: normalizedImage, cgImage: cgImage)
                await MainActor.run {
                    call.resolve([
                        "base64": result.data.base64EncodedString(),
                        "mimeType": "image/png",
                        "width": cgImage.width,
                        "height": cgImage.height,
                        "method": result.method
                    ])
                }
            } catch {
                await MainActor.run {
                    call.reject(error.localizedDescription)
                }
            }
        }
    }

    private func removeBackgroundData(image: UIImage, cgImage: CGImage) async throws -> (data: Data, method: String) {
        do {
            return (try await removeSubjectLiftData(image: image), "subjectLift")
        } catch {
            NSLog("[NativeVision] subject lift background removal failed: %@", error.localizedDescription)
        }

        guard #available(iOS 17.0, *) else {
            throw NSError(domain: "NativeVision", code: 404, userInfo: [
                NSLocalizedDescriptionKey: "没有找到可去背景的主体"
            ])
        }
        return (try removeForegroundMaskData(cgImage: cgImage), "foregroundMask")
    }

    @MainActor
    private func removeSubjectLiftData(image: UIImage) async throws -> Data {
        guard #available(iOS 16.0, *), ImageAnalyzer.isSupported else {
            throw NSError(domain: "NativeVision", code: 501, userInfo: [
                NSLocalizedDescriptionKey: "当前设备不支持主体抠图"
            ])
        }
        guard let parentView = bridge?.viewController?.view else {
            throw NSError(domain: "NativeVision", code: 500, userInfo: [
                NSLocalizedDescriptionKey: "主体抠图视图未就绪"
            ])
        }

        let imageWidth = max(1, image.size.width)
        let imageHeight = max(1, image.size.height)
        let viewWidth = min(max(imageWidth, 320), 900)
        let viewHeight = max(1, viewWidth * imageHeight / imageWidth)

        let imageView = UIImageView(image: image)
        imageView.frame = CGRect(x: -viewWidth - 72, y: -viewHeight - 72, width: viewWidth, height: viewHeight)
        imageView.bounds = CGRect(x: 0, y: 0, width: viewWidth, height: viewHeight)
        imageView.contentMode = .scaleAspectFit
        imageView.isUserInteractionEnabled = true
        imageView.alpha = 0.01

        let interaction = ImageAnalysisInteraction()
        interaction.preferredInteractionTypes = [.imageSubject]
        imageView.addInteraction(interaction)
        parentView.addSubview(imageView)
        imageView.layoutIfNeeded()

        defer {
            imageView.removeInteraction(interaction)
            imageView.removeFromSuperview()
        }

        let analyzer = ImageAnalyzer()
        let configuration = ImageAnalyzer.Configuration([.visualLookUp])
        let analysis = try await analyzer.analyze(image, configuration: configuration)
        interaction.analysis = analysis
        interaction.preferredInteractionTypes = [.imageSubject]

        var subjects = await interaction.subjects
        for _ in 0..<12 where subjects.isEmpty {
            try? await Task.sleep(nanoseconds: 120_000_000)
            subjects = await interaction.subjects
        }

        guard !subjects.isEmpty else {
            throw NSError(domain: "NativeVision", code: 404, userInfo: [
                NSLocalizedDescriptionKey: "没有找到可抠出的主体"
            ])
        }

        let cutout = try await interaction.image(for: subjects)
        guard let data = cutout.pngData() else {
            throw NSError(domain: "NativeVision", code: 500, userInfo: [
                NSLocalizedDescriptionKey: "主体图片导出失败"
            ])
        }
        return data
    }

    @available(iOS 17.0, *)
    private func removeForegroundMaskData(cgImage: CGImage) throws -> Data {
        let request = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
        try handler.perform([request])

        guard let observation = request.results?.first,
              !observation.allInstances.isEmpty else {
            throw NSError(domain: "NativeVision", code: 404, userInfo: [
                NSLocalizedDescriptionKey: "没有找到可去背景的主体"
            ])
        }

        let maskBuffer = try observation.generateScaledMaskForImage(
            forInstances: observation.allInstances,
            from: handler
        )
        let input = CIImage(cgImage: cgImage)
        var mask = CIImage(cvPixelBuffer: maskBuffer)
        if mask.extent.size.width > 0, mask.extent.size.height > 0, mask.extent.size != input.extent.size {
            let scaleX = input.extent.width / mask.extent.width
            let scaleY = input.extent.height / mask.extent.height
            mask = mask
                .transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
                .cropped(to: input.extent)
        }

        let transparent = CIImage(color: CIColor(red: 0, green: 0, blue: 0, alpha: 0))
            .cropped(to: input.extent)
        guard let filter = CIFilter(name: "CIBlendWithMask") else {
            throw NSError(domain: "NativeVision", code: 500, userInfo: [
                NSLocalizedDescriptionKey: "去背景滤镜不可用"
            ])
        }
        filter.setValue(input, forKey: kCIInputImageKey)
        filter.setValue(transparent, forKey: kCIInputBackgroundImageKey)
        filter.setValue(mask, forKey: kCIInputMaskImageKey)

        guard let output = filter.outputImage?.cropped(to: input.extent) else {
            throw NSError(domain: "NativeVision", code: 500, userInfo: [
                NSLocalizedDescriptionKey: "去背景生成失败"
            ])
        }

        let context = CIContext()
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let data = context.pngRepresentation(of: output, format: .RGBA8, colorSpace: colorSpace) else {
            throw NSError(domain: "NativeVision", code: 500, userInfo: [
                NSLocalizedDescriptionKey: "去背景图片导出失败"
            ])
        }
        return data
    }

    @MainActor
    private func detectSubjectLiftSubjects(
        image: UIImage,
        minArea: Double,
        maxItems: Int
    ) async -> [NativeVisionSubject] {
        guard #available(iOS 16.0, *), ImageAnalyzer.isSupported else { return [] }
        guard let parentView = bridge?.viewController?.view else { return [] }

        let imageWidth = max(1, image.size.width)
        let imageHeight = max(1, image.size.height)
        let parentBounds = parentView.bounds.width > 1 && parentView.bounds.height > 1
            ? parentView.bounds
            : UIScreen.main.bounds
        let imageFrame = aspectFitRect(
            imageSize: CGSize(width: imageWidth, height: imageHeight),
            boundingSize: parentBounds.size
        )
        guard imageFrame.width > 1, imageFrame.height > 1 else { return [] }

        let hostView = UIView(frame: parentBounds)
        hostView.backgroundColor = UIColor.black.withAlphaComponent(0.08)
        hostView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        hostView.isUserInteractionEnabled = true

        let imageView = UIImageView(image: image)
        imageView.frame = imageFrame
        imageView.bounds = CGRect(x: 0, y: 0, width: imageFrame.width, height: imageFrame.height)
        imageView.contentMode = .scaleAspectFit
        imageView.isUserInteractionEnabled = true

        let interaction = ImageAnalysisInteraction()
        interaction.preferredInteractionTypes = [.imageSubject]
        imageView.addInteraction(interaction)
        hostView.addSubview(imageView)
        parentView.addSubview(hostView)
        parentView.bringSubviewToFront(hostView)
        hostView.layoutIfNeeded()
        imageView.layoutIfNeeded()

        defer {
            imageView.removeInteraction(interaction)
            hostView.removeFromSuperview()
        }

        do {
            try? await Task.sleep(nanoseconds: 120_000_000)
            let analyzer = ImageAnalyzer()
            let configuration = ImageAnalyzer.Configuration([.visualLookUp])
            let analysis = try await analyzer.analyze(image, configuration: configuration)
            interaction.analysis = analysis
            interaction.preferredInteractionTypes = [.imageSubject]

            var rawSubjects = await interaction.subjects
            for _ in 0..<12 where rawSubjects.isEmpty {
                try? await Task.sleep(nanoseconds: 120_000_000)
                rawSubjects = await interaction.subjects
            }

            return rawSubjects
                .compactMap { subject -> NativeVisionSubject? in
                    let bounds = subject.bounds
                    guard bounds.width > 0, bounds.height > 0 else { return nil }
                    let rect = CGRect(
                        x: bounds.minX / imageFrame.width,
                        y: bounds.minY / imageFrame.height,
                        width: bounds.width / imageFrame.width,
                        height: bounds.height / imageFrame.height
                    ).expanded(x: 0.012, y: 0.012).clampedUnit()
                    guard rect.width * rect.height >= minArea else { return nil }
                    return NativeVisionSubject(
                        id: "subject-\(subject.hashValue)",
                        rect: rect,
                        confidence: 0.88,
                        source: "subject"
                    )
                }
                .sorted { lhs, rhs in
                    if abs(lhs.rect.minY - rhs.rect.minY) > 0.03 { return lhs.rect.minY < rhs.rect.minY }
                    return lhs.rect.minX < rhs.rect.minX
                }
                .prefix(maxItems)
                .map { $0 }
        } catch {
            NSLog("[NativeVision] subject lift failed: %@", error.localizedDescription)
            return []
        }
    }

    private func detectBackgroundAnalysis(
        cgImage: CGImage,
        orientation: CGImagePropertyOrientation,
        minArea: Double,
        maxItems: Int
    ) async throws -> NativeVisionBackgroundAnalysis {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let foregroundSubjects = try NativeVisionPlugin.detectForegroundSubjects(cgImage: cgImage, orientation: orientation, minArea: minArea, maxItems: maxItems)
                    let saliencySubjects = try NativeVisionPlugin.detectSaliencySubjects(cgImage: cgImage, orientation: orientation, minArea: minArea, maxItems: maxItems)
                    let textureSubjects = NativeVisionPlugin.detectTextureSubjects(cgImage: cgImage, minArea: minArea, maxItems: maxItems)
                    continuation.resume(returning: NativeVisionBackgroundAnalysis(
                        foregroundSubjects: foregroundSubjects,
                        saliencySubjects: saliencySubjects,
                        textureSubjects: textureSubjects
                    ))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private static func detectForegroundSubjects(
        cgImage: CGImage,
        orientation: CGImagePropertyOrientation,
        minArea: Double,
        maxItems: Int
    ) throws -> [NativeVisionSubject] {
        guard #available(iOS 17.0, *) else {
            return []
        }

        let request = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
        try handler.perform([request])

        guard let observation = request.results?.first else { return [] }
        let width = cgImage.width
        let height = cgImage.height

        return try observation.allInstances
            .compactMap { instanceIndex -> NativeVisionSubject? in
                let mask = try observation.generateScaledMaskForImage(forInstances: IndexSet(integer: instanceIndex), from: handler)
                guard let rect = boundingRect(from: mask, imageWidth: width, imageHeight: height) else {
                    return nil
                }
                let area = Double(rect.width * rect.height)
                guard area >= minArea, area <= 0.88 else { return nil }
                return NativeVisionSubject(
                    id: "foreground-\(instanceIndex)",
                    rect: rect,
                    confidence: min(0.82, max(0.5, 0.56 + area * 1.2)),
                    source: "foreground"
                )
            }
            .sorted { ($0.rect.width * $0.rect.height) > ($1.rect.width * $1.rect.height) }
            .prefix(maxItems)
            .map { $0 }
    }

    private static func detectSaliencySubjects(
        cgImage: CGImage,
        orientation: CGImagePropertyOrientation,
        minArea: Double,
        maxItems: Int
    ) throws -> [NativeVisionSubject] {
        var subjects: [NativeVisionSubject] = []

        let request = VNGenerateObjectnessBasedSaliencyImageRequest()
        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
        try handler.perform([request])

        if let observation = request.results?.first {
            subjects.append(contentsOf: saliencySubjects(from: observation, prefix: "saliency-object", minArea: minArea, maxItems: maxItems))
        }

        let attentionRequest = VNGenerateAttentionBasedSaliencyImageRequest()
        let attentionHandler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
        try attentionHandler.perform([attentionRequest])

        if let observation = attentionRequest.results?.first {
            subjects.append(contentsOf: saliencySubjects(from: observation, prefix: "saliency-attention", minArea: minArea, maxItems: maxItems))
        }

        return mergeSubjects(groups: [subjects], maxItems: maxItems)
    }

    private static func saliencySubjects(
        from observation: VNSaliencyImageObservation,
        prefix: String,
        minArea: Double,
        maxItems: Int
    ) -> [NativeVisionSubject] {
        let objectSubjects = (observation.salientObjects ?? [])
            .enumerated()
            .compactMap { offset, object -> NativeVisionSubject? in
                let rect = visionRectToTopLeft(object.boundingBox)
                    .expanded(x: 0.018, y: 0.018)
                    .clampedUnit()
                let area = Double(rect.width * rect.height)
                guard area >= minArea, area <= 0.82 else { return nil }
                return NativeVisionSubject(
                    id: "\(prefix)-rect-\(offset)",
                    rect: rect,
                    confidence: max(0.38, min(0.7, Double(object.confidence))),
                    source: "saliency"
                )
            }
        return mergeSubjects(groups: [objectSubjects], maxItems: maxItems)
    }

    private static func detectTextureSubjects(
        cgImage: CGImage,
        minArea: Double,
        maxItems: Int
    ) -> [NativeVisionSubject] {
        return []
    }

}

private struct NativeVisionBackgroundAnalysis {
    let foregroundSubjects: [NativeVisionSubject]
    let saliencySubjects: [NativeVisionSubject]
    let textureSubjects: [NativeVisionSubject]
}

private struct NativeVisionSubject {
    let id: String
    let rect: CGRect
    let confidence: Double
    let source: String
}

private struct NativeVisionImageSample {
    let width: Int
    let height: Int
    let bytes: [UInt8]
}

private extension CGRect {
    func asJSObject() -> [String: Any] {
        [
            "x": origin.x,
            "y": origin.y,
            "w": width,
            "h": height
        ]
    }

    func clampedUnit() -> CGRect {
        var x = max(0, min(1, origin.x))
        var y = max(0, min(1, origin.y))
        var w = max(0, min(1, width))
        var h = max(0, min(1, height))
        if x + w > 1 { w = 1 - x }
        if y + h > 1 { h = 1 - y }
        if w < 0 { x = 0; w = 0 }
        if h < 0 { y = 0; h = 0 }
        return CGRect(x: x, y: y, width: w, height: h)
    }

    func expanded(x padX: CGFloat, y padY: CGFloat) -> CGRect {
        CGRect(
            x: origin.x - padX,
            y: origin.y - padY,
            width: width + padX * 2,
            height: height + padY * 2
        )
    }
}

private func normalizedImage(from image: UIImage) -> UIImage? {
    if image.imageOrientation == .up, let cgImage = image.cgImage {
        return UIImage(cgImage: cgImage, scale: 1, orientation: .up)
    }
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    let renderer = UIGraphicsImageRenderer(size: image.size, format: format)
    return renderer.image { _ in
        image.draw(in: CGRect(origin: .zero, size: image.size))
    }
}

private func visionRectToTopLeft(_ rect: CGRect) -> CGRect {
    CGRect(
        x: max(0, min(1, rect.origin.x)),
        y: max(0, min(1, 1 - rect.origin.y - rect.height)),
        width: max(0, min(1, rect.width)),
        height: max(0, min(1, rect.height))
    ).clampedUnit()
}

private func aspectFitRect(imageSize: CGSize, boundingSize: CGSize) -> CGRect {
    guard imageSize.width > 0, imageSize.height > 0, boundingSize.width > 0, boundingSize.height > 0 else {
        return .zero
    }

    let scale = min(boundingSize.width / imageSize.width, boundingSize.height / imageSize.height)
    let width = imageSize.width * scale
    let height = imageSize.height * scale
    return CGRect(
        x: (boundingSize.width - width) / 2,
        y: (boundingSize.height - height) / 2,
        width: width,
        height: height
    )
}

private func boundingRect(from pixelBuffer: CVPixelBuffer, imageWidth: Int, imageHeight: Int) -> CGRect? {
    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

    guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else { return nil }

    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
    let pixelFormat = CVPixelBufferGetPixelFormatType(pixelBuffer)
    let step = max(1, max(width, height) / 900)

    var minX = width
    var minY = height
    var maxX = -1
    var maxY = -1

    var y = 0
    while y < height {
        var x = 0
        while x < width {
            if pixelBufferValue(baseAddress: baseAddress, bytesPerRow: bytesPerRow, pixelFormat: pixelFormat, x: x, y: y) > 0.001 {
                minX = min(minX, x)
                minY = min(minY, y)
                maxX = max(maxX, x)
                maxY = max(maxY, y)
            }
            x += step
        }
        y += step
    }

    guard maxX >= minX, maxY >= minY else { return nil }

    let scaleX = Double(imageWidth) / Double(width)
    let scaleY = Double(imageHeight) / Double(height)
    let padX = 10.0 / Double(imageWidth)
    let padY = 10.0 / Double(imageHeight)
    let x = Double(minX) * scaleX / Double(imageWidth) - padX
    let yTop = Double(minY) * scaleY / Double(imageHeight) - padY
    let w = Double(maxX - minX + step) * scaleX / Double(imageWidth) + padX * 2
    let h = Double(maxY - minY + step) * scaleY / Double(imageHeight) + padY * 2

    return CGRect(x: x, y: yTop, width: w, height: h).clampedUnit()
}

private func heatmapRects(from pixelBuffer: CVPixelBuffer, minArea: Double) -> [CGRect] {
    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

    guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else { return [] }

    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
    let pixelFormat = CVPixelBufferGetPixelFormatType(pixelBuffer)
    guard width > 2, height > 2 else { return [] }

    var values = [Double](repeating: 0, count: width * height)
    var maxValue = 0.0
    var nonZeroValues: [Double] = []
    nonZeroValues.reserveCapacity(width * height)

    for y in 0..<height {
        for x in 0..<width {
            let value = pixelBufferValue(baseAddress: baseAddress, bytesPerRow: bytesPerRow, pixelFormat: pixelFormat, x: x, y: y)
            values[y * width + x] = value
            if value > 0 {
                maxValue = max(maxValue, value)
                nonZeroValues.append(value)
            }
        }
    }

    guard maxValue > 0.001, !nonZeroValues.isEmpty else { return [] }
    nonZeroValues.sort()
    let percentileIndex = min(nonZeroValues.count - 1, max(0, Int(Double(nonZeroValues.count - 1) * 0.78)))
    let percentileThreshold = nonZeroValues[percentileIndex]
    let threshold = max(maxValue * 0.42, percentileThreshold)

    var mask = [UInt8](repeating: 0, count: width * height)
    for y in 0..<height {
        for x in 0..<width where values[y * width + x] >= threshold {
            mask[y * width + x] = 1
        }
    }

    mask = dilatedMask(mask, width: width, height: height, radius: 1)
    return componentRects(
        mask: mask,
        width: width,
        height: height,
        minArea: max(0.012, minArea),
        maxArea: 0.72,
        rejectEdgeNoise: false
    )
}

private func pixelBufferValue(
    baseAddress: UnsafeMutableRawPointer,
    bytesPerRow: Int,
    pixelFormat: OSType,
    x: Int,
    y: Int
) -> Double {
    let row = baseAddress.advanced(by: y * bytesPerRow)
    switch pixelFormat {
    case kCVPixelFormatType_OneComponent8:
        return Double(row.assumingMemoryBound(to: UInt8.self)[x]) / 255.0
    case kCVPixelFormatType_OneComponent16Half:
        return Double(row.assumingMemoryBound(to: UInt16.self)[x]) / 65535.0
    case kCVPixelFormatType_OneComponent32Float:
        let value = row.assumingMemoryBound(to: Float.self)[x]
        return value.isFinite ? Double(value) : 0
    case kCVPixelFormatType_32BGRA, kCVPixelFormatType_32RGBA:
        let data = row.assumingMemoryBound(to: UInt8.self)
        let offset = x * 4
        return Double(max(data[offset], max(data[offset + 1], max(data[offset + 2], data[offset + 3])))) / 255.0
    default:
        return Double(row.assumingMemoryBound(to: UInt8.self)[x]) / 255.0
    }
}

private func downsampleRGBA(cgImage: CGImage, maxSide: Int) -> NativeVisionImageSample? {
    let imageWidth = cgImage.width
    let imageHeight = cgImage.height
    guard imageWidth > 0, imageHeight > 0 else { return nil }

    let scale = min(1.0, Double(maxSide) / Double(max(imageWidth, imageHeight)))
    let width = max(1, Int((Double(imageWidth) * scale).rounded()))
    let height = max(1, Int((Double(imageHeight) * scale).rounded()))
    let bytesPerRow = width * 4
    var bytes = [UInt8](repeating: 0, count: height * bytesPerRow)
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue

    let ok = bytes.withUnsafeMutableBytes { pointer -> Bool in
        guard let baseAddress = pointer.baseAddress,
              let context = CGContext(
                  data: baseAddress,
                  width: width,
                  height: height,
                  bitsPerComponent: 8,
                  bytesPerRow: bytesPerRow,
                  space: colorSpace,
                  bitmapInfo: bitmapInfo
              ) else {
            return false
        }
        context.interpolationQuality = .medium
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        return true
    }

    guard ok else { return nil }
    return NativeVisionImageSample(width: width, height: height, bytes: bytes)
}

private func luma(r: Int, g: Int, b: Int) -> Int {
    Int((0.2126 * Double(r) + 0.7152 * Double(g) + 0.0722 * Double(b)).rounded())
}

private func colorGradient(
    pixels: [UInt8],
    width: Int,
    height: Int,
    x: Int,
    y: Int,
    dx: Int,
    dy: Int
) -> Int {
    let nx = x + dx
    let ny = y + dy
    guard nx >= 0, ny >= 0, nx < width, ny < height else { return 0 }

    let offset = (y * width + x) * 4
    let nextOffset = (ny * width + nx) * 4
    return abs(Int(pixels[offset]) - Int(pixels[nextOffset]))
        + abs(Int(pixels[offset + 1]) - Int(pixels[nextOffset + 1]))
        + abs(Int(pixels[offset + 2]) - Int(pixels[nextOffset + 2]))
}

private func dilatedMask(_ source: [UInt8], width: Int, height: Int, radius: Int) -> [UInt8] {
    var output = [UInt8](repeating: 0, count: source.count)
    for y in 0..<height {
        for x in 0..<width where source[y * width + x] != 0 {
            let minY = max(0, y - radius)
            let maxY = min(height - 1, y + radius)
            let minX = max(0, x - radius)
            let maxX = min(width - 1, x + radius)
            for yy in minY...maxY {
                let row = yy * width
                for xx in minX...maxX {
                    output[row + xx] = 1
                }
            }
        }
    }
    return output
}

private func componentRects(
    mask: [UInt8],
    width: Int,
    height: Int,
    minArea: Double,
    maxArea: Double,
    rejectEdgeNoise: Bool
) -> [CGRect] {
    var visited = [UInt8](repeating: 0, count: mask.count)
    var rects: [CGRect] = []
    var stack: [Int] = []
    stack.reserveCapacity(4096)

    for y in 0..<height {
        for x in 0..<width {
            let start = y * width + x
            guard mask[start] != 0, visited[start] == 0 else { continue }

            var minX = x
            var maxX = x
            var minY = y
            var maxY = y
            var count = 0
            stack.removeAll(keepingCapacity: true)
            stack.append(start)
            visited[start] = 1

            while let current = stack.popLast() {
                count += 1
                let cy = current / width
                let cx = current - cy * width
                minX = min(minX, cx)
                maxX = max(maxX, cx)
                minY = min(minY, cy)
                maxY = max(maxY, cy)

                if cx > 0 {
                    let next = current - 1
                    if mask[next] != 0, visited[next] == 0 {
                        visited[next] = 1
                        stack.append(next)
                    }
                }
                if cx + 1 < width {
                    let next = current + 1
                    if mask[next] != 0, visited[next] == 0 {
                        visited[next] = 1
                        stack.append(next)
                    }
                }
                if cy > 0 {
                    let next = current - width
                    if mask[next] != 0, visited[next] == 0 {
                        visited[next] = 1
                        stack.append(next)
                    }
                }
                if cy + 1 < height {
                    let next = current + width
                    if mask[next] != 0, visited[next] == 0 {
                        visited[next] = 1
                        stack.append(next)
                    }
                }
            }

            let rectWidthPixels = maxX - minX + 1
            let rectHeightPixels = maxY - minY + 1
            let rectArea = Double(rectWidthPixels * rectHeightPixels) / Double(width * height)
            let fill = Double(count) / Double(max(1, rectWidthPixels * rectHeightPixels))
            let rx = Double(minX) / Double(width)
            let ry = Double(minY) / Double(height)
            let rw = Double(rectWidthPixels) / Double(width)
            let rh = Double(rectHeightPixels) / Double(height)
            let touchesVerticalEdge = rx < 0.035 || rx + rw > 0.965
            let edgeBandNoise = rejectEdgeNoise && touchesVerticalEdge && (rh > 0.52 || rw < 0.08)

            guard rectArea >= minArea,
                  rectArea <= maxArea,
                  rw >= 0.05,
                  rh >= 0.04,
                  fill >= 0.08,
                  !edgeBandNoise else {
                continue
            }

            rects.append(CGRect(x: rx, y: ry, width: rw, height: rh).clampedUnit())
        }
    }

    return rects
        .sorted { lhs, rhs in
            if abs(lhs.minY - rhs.minY) > 0.03 { return lhs.minY < rhs.minY }
            return lhs.minX < rhs.minX
        }
}

private func mergeSubjects(groups: [[NativeVisionSubject]], maxItems: Int) -> [NativeVisionSubject] {
    var result: [NativeVisionSubject] = []
    for group in groups {
        for subject in group {
            let duplicate = result.contains { existing in
                overlapRatio(existing.rect, subject.rect) > 0.6
            }
            if !duplicate {
                result.append(subject)
            }
            if result.count >= maxItems {
                return result
            }
        }
    }
    return result
}

private func overlapRatio(_ a: CGRect, _ b: CGRect) -> CGFloat {
    let intersection = a.intersection(b)
    if intersection.isNull { return 0 }
    let smaller = max(0.0001, min(a.width * a.height, b.width * b.height))
    return (intersection.width * intersection.height) / smaller
}
