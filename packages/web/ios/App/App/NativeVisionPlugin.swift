import Capacitor
import AVFoundation
import CoreImage
import CoreVideo
import ImageIO
import UIKit
import Vision
import VisionKit

private let nativeVisionDebugQueue = DispatchQueue(label: "home-inventory.native-vision.debug-log")

private func nativeVisionDebugLogURL() -> URL? {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
        .appendingPathComponent("native-vision-debug.log")
}

private func resetNativeVisionDebugLog(sessionId: String) {
    guard let url = nativeVisionDebugLogURL() else { return }
    let line = "=== NativeVision debug session \(sessionId) \(Date()) ===\n"
    nativeVisionDebugQueue.async {
        try? line.write(to: url, atomically: true, encoding: .utf8)
    }
}

private func nativeVisionDebugLog(_ label: String, _ message: String) {
    let line = "\(Date()) [NativeVision][\(label)] \(message)\n"
    NSLog("%@", line.trimmingCharacters(in: .newlines))
    guard let data = line.data(using: .utf8),
          let url = nativeVisionDebugLogURL() else {
        return
    }
    nativeVisionDebugQueue.async {
        if FileManager.default.fileExists(atPath: url.path) {
            guard let handle = try? FileHandle(forWritingTo: url) else { return }
            defer { try? handle.close() }
            try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        } else {
            try? data.write(to: url)
        }
    }
}

@objc(NativeVisionPlugin)
public class NativeVisionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeVisionPlugin"
    public let jsName = "NativeVision"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "analyzeImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeBackground", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capturePhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "captureRecognizedItems", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "applyRecognizedItemLabels", returnType: CAPPluginReturnPromise)
    ]
    private var activeCameraController: NativeAutoCameraViewController?

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

    @objc func capturePhoto(_ call: CAPPluginCall) {
        requestCameraAccess(call) { [weak self] in
            self?.presentAutoCamera(call, recognizesItems: false)
        }
    }

    @objc func captureRecognizedItems(_ call: CAPPluginCall) {
        requestCameraAccess(call) { [weak self] in
            self?.presentAutoCamera(call, recognizesItems: true)
        }
    }

    @objc func applyRecognizedItemLabels(_ call: CAPPluginCall) {
        guard let sessionId = call.getString("sessionId") else {
            call.reject("缺少识别会话")
            return
        }
        let rawItems = call.getArray("items") as? [[String: Any]] ?? []
        DispatchQueue.main.async { [weak self] in
            self?.activeCameraController?.applyRecognizedItemLabels(sessionId: sessionId, labels: rawItems)
            call.resolve(["ok": true])
        }
    }

    private func requestCameraAccess(_ call: CAPPluginCall, presentCamera: @escaping () -> Void) {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            call.reject("当前设备没有可用相机")
            return
        }

        let presentOnMain = {
            DispatchQueue.main.async {
                presentCamera()
            }
        }

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            presentOnMain()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                if granted {
                    presentOnMain()
                } else {
                    call.reject("没有相机权限")
                }
            }
        case .denied, .restricted:
            call.reject("没有相机权限")
        @unknown default:
            call.reject("相机权限状态不可用")
        }
    }

    private func presentAutoCamera(_ call: CAPPluginCall, recognizesItems: Bool) {
        guard activeCameraController == nil else {
            call.reject("相机正在使用中")
            return
        }
        guard let parent = bridge?.viewController else {
            call.reject("相机视图未就绪")
            return
        }

        let camera = NativeAutoCameraViewController()
        camera.showsRecognitionAnimation = recognizesItems
        camera.modalPresentationStyle = .fullScreen
        camera.onCancel = { [weak self] in
            self?.activeCameraController = nil
            call.resolve(["cancelled": true])
        }
        camera.onCapture = { [weak self] result in
            switch result {
            case .success(let payload):
                self?.activeCameraController = nil
                if recognizesItems {
                    call.resolve(payload.asRecognizedJSObject())
                } else {
                    call.resolve([
                        "base64": payload.photoData.base64EncodedString(),
                        "mimeType": "image/jpeg"
                    ])
                }
            case .failure(let error):
                self?.activeCameraController = nil
                call.reject(error.localizedDescription)
            }
        }
        camera.onCapturedImage = { [weak self, weak camera] image in
            guard recognizesItems else {
                guard let data = image.jpegData(compressionQuality: 0.92) else {
                    await MainActor.run {
                        camera?.finish(.failure(NSError(domain: "NativeVision", code: 603, userInfo: [
                            NSLocalizedDescriptionKey: "照片导出失败"
                        ])))
                    }
                    return
                }
                await MainActor.run {
                    camera?.finish(.success(NativeCameraCapturePayload(
                        photoData: data,
                        width: Int(image.size.width),
                        height: Int(image.size.height),
                        items: []
                    )))
                }
                return
            }

            guard let self, let camera else { return }
            await self.processRecognizedCapture(image: image, camera: camera)
        }
        activeCameraController = camera
        parent.present(camera, animated: true)
    }

    private func processRecognizedCapture(image: UIImage, camera: NativeAutoCameraViewController) async {
        do {
            guard let cgImage = image.cgImage,
                  let photoData = image.jpegData(compressionQuality: 0.92) else {
                throw NSError(domain: "NativeVision", code: 603, userInfo: [
                    NSLocalizedDescriptionKey: "照片导出失败"
                ])
            }
            let debugSessionId = String(UUID().uuidString.prefix(8))
            resetNativeVisionDebugLog(sessionId: debugSessionId)
            nativeVisionDebugLog(debugSessionId, "capture processing started image=\(cgImage.width)x\(cgImage.height)")
            await MainActor.run {
                camera.beginRecognizedItemLabeling(sessionId: debugSessionId)
            }

            let analysis = try await detectBackgroundAnalysis(
                cgImage: cgImage,
                orientation: .up,
                minArea: 0.003,
                maxItems: 12
            )
            var subjects = mergeSubjects(
                groups: [analysis.foregroundSubjects, analysis.saliencySubjects, analysis.textureSubjects],
                maxItems: 12
            )
            if subjects.isEmpty {
                subjects = [
                    NativeVisionSubject(
                        id: "subject-full-frame",
                        rect: CGRect(x: 0.08, y: 0.12, width: 0.84, height: 0.72),
                        confidence: 0.35,
                        source: "subject"
                    )
                ]
            }
            await MainActor.run {
                camera.updateStatus(title: "正在抠出物品", detail: "识别到 \(subjects.count) 个候选")
                camera.showDetectionMarkers(
                    subjects.map { $0.rect },
                    imageSize: CGSize(width: cgImage.width, height: cgImage.height)
                )
            }

            var items: [NativeCameraStickerItem] = []
            for (index, subject) in subjects.enumerated() {
                try Task.checkCancellation()
                let debugItemId = "\(debugSessionId)-item-\(index + 1)"
                nativeVisionDebugLog(debugItemId, "item begin rect=\(NSCoder.string(for: subject.rect)) confidence=\(subject.confidence) source=\(subject.source)")
                await MainActor.run {
                    camera.updateStatus(title: "正在抠出物品", detail: "\(index + 1)/\(subjects.count) 正在生成透明图")
                }
                guard let crop = cropImage(image: image, normalizedRect: subject.rect, maxSide: 900, paddingRatio: 0.08),
                      let cropCGImage = crop.cgImage else {
                    nativeVisionDebugLog(debugItemId, "crop failed")
                    continue
                }
                nativeVisionDebugLog(debugItemId, "crop ready size=\(cropCGImage.width)x\(cropCGImage.height)")

                let cutoutResult = try? await removeBackgroundData(
                    image: crop,
                    cgImage: cropCGImage,
                    parentView: camera.view,
                    mode: .stableBatch
                )
                guard let cutoutData = cutoutResult?.data,
                      UIImage(data: cutoutData) != nil else {
                    nativeVisionDebugLog(debugItemId, "cutout failed or invalid")
                    continue
                }
                nativeVisionDebugLog(debugItemId, "cutout ready bytes=\(cutoutData.count) method=\(cutoutResult?.method ?? "unknown")")

                let itemId = subject.id.isEmpty ? "native-item-\(index + 1)" : subject.id

                let item = NativeCameraStickerItem(
                    id: itemId,
                    name: "物品 \(items.count + 1)",
                    nativeCategory: nil,
                    categoryConfidence: nil,
                    rect: subject.rect,
                    confidence: subject.confidence,
                    source: subject.source,
                    imageData: cutoutData,
                    cutoutData: cutoutData
                )
                items.append(item)
            }

            guard !items.isEmpty else {
                throw NSError(domain: "NativeVision", code: 404, userInfo: [
                    NSLocalizedDescriptionKey: "没有找到可生成贴纸的物品"
                ])
            }
            nativeVisionDebugLog(debugSessionId, "notify LLM item images count=\(items.count)")
            await MainActor.run {
                self.notifyRecognizedItemImagesForLLM(sessionId: debugSessionId, items: items)
                camera.updateStatus(title: "正在描边", detail: "\(items.count) 件物品已开始 AI 命名")
            }

            for index in items.indices {
                try Task.checkCancellation()
                let itemLabel = "\(debugSessionId)-item-\(index + 1)"
                await MainActor.run {
                    camera.updateStatus(title: "正在描边", detail: "\(index + 1)/\(items.count) 正在生成白色描边")
                }
                guard let stickerData = addWhiteStickerOutlineData(items[index].cutoutData),
                      UIImage(data: stickerData) != nil else {
                    nativeVisionDebugLog(itemLabel, "outline failed")
                    continue
                }
                nativeVisionDebugLog(itemLabel, "outline ready bytes=\(stickerData.count)")
                items[index].imageData = stickerData
            }
            nativeVisionDebugLog(debugSessionId, "presenting native review items=\(items.count)")

            await MainActor.run {
                camera.presentNativeReview(
                    sessionId: debugSessionId,
                    photoData: photoData,
                    width: cgImage.width,
                    height: cgImage.height,
                    items: items
                )
            }
        } catch {
            await MainActor.run {
                camera.showFailure(message: error.localizedDescription)
            }
            try? await Task.sleep(nanoseconds: 900_000_000)
            await MainActor.run {
                camera.finish(.failure(error))
            }
        }
    }

    private func notifyRecognizedItemImagesForLLM(sessionId: String, items: [NativeCameraStickerItem]) {
        let payloadItems = items.map { item in
            [
                "id": item.id,
                "imageBase64": item.cutoutData.base64EncodedString(),
                "imageMimeType": "image/png"
            ] as [String: Any]
        }
        notifyListeners("nativeItemImagesReady", data: [
            "sessionId": sessionId,
            "items": payloadItems
        ])
    }

    private enum NativeCutoutMode {
        case automatic
        case stableBatch
        case diagnosticSubjectLift(String)
    }

    private func removeBackgroundData(
        image: UIImage,
        cgImage: CGImage,
        parentView: UIView? = nil,
        mode: NativeCutoutMode = .automatic
    ) async throws -> (data: Data, method: String) {
        switch mode {
        case .stableBatch:
            guard #available(iOS 17.0, *) else {
                throw NSError(domain: "NativeVision", code: 501, userInfo: [
                    NSLocalizedDescriptionKey: "当前系统不支持稳定批量抠图"
                ])
            }
            let startedAt = Date()
            let data = try removeForegroundMaskData(cgImage: cgImage)
            nativeVisionDebugLog("stableBatch", "stable foreground mask cutout finished in \(Date().timeIntervalSince(startedAt))s")
            return (data, "foregroundMask")
        case .diagnosticSubjectLift(let label):
            let startedAt = Date()
            nativeVisionDebugLog(label, "diagnostic subjectLift cutout begin")
            do {
                let data = try await removeSubjectLiftData(image: image, parentView: parentView, debugLabel: label)
                nativeVisionDebugLog(label, "diagnostic subjectLift cutout end \(Date().timeIntervalSince(startedAt))s bytes=\(data.count)")
                return (data, "subjectLift")
            } catch {
                nativeVisionDebugLog(label, "diagnostic subjectLift cutout throw \(Date().timeIntervalSince(startedAt))s error=\(error.localizedDescription)")
                throw error
            }
        case .automatic:
            break
        }

        do {
            return (try await removeSubjectLiftData(image: image, parentView: parentView, debugLabel: nil), "subjectLift")
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
    private func removeSubjectLiftData(
        image: UIImage,
        parentView explicitParentView: UIView? = nil,
        debugLabel: String? = nil
    ) async throws -> Data {
        if let debugLabel {
            nativeVisionDebugLog(debugLabel, "subjectLift enter mainActor imageSize=\(Int(image.size.width))x\(Int(image.size.height))")
        }
        guard #available(iOS 16.0, *), ImageAnalyzer.isSupported else {
            throw NSError(domain: "NativeVision", code: 501, userInfo: [
                NSLocalizedDescriptionKey: "当前设备不支持主体抠图"
            ])
        }
        guard let parentView = explicitParentView ?? bridge?.viewController?.view else {
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
        if let debugLabel {
            nativeVisionDebugLog(debugLabel, "subjectLift hidden interaction view mounted frame=\(NSCoder.string(for: imageView.frame))")
        }

        defer {
            if let debugLabel {
                nativeVisionDebugLog(debugLabel, "subjectLift cleanup")
            }
            imageView.removeInteraction(interaction)
            imageView.removeFromSuperview()
        }

        let analyzer = ImageAnalyzer()
        let configuration = ImageAnalyzer.Configuration([.visualLookUp])
        if let debugLabel {
            nativeVisionDebugLog(debugLabel, "subjectLift analyzer.analyze begin")
        }
        let analysis = try await analyzer.analyze(image, configuration: configuration)
        if let debugLabel {
            nativeVisionDebugLog(debugLabel, "subjectLift analyzer.analyze end")
        }
        interaction.analysis = analysis
        interaction.preferredInteractionTypes = [.imageSubject]

        if let debugLabel {
            nativeVisionDebugLog(debugLabel, "subjectLift interaction.subjects begin")
        }
        let subjects = await interaction.subjects
        if let debugLabel {
            nativeVisionDebugLog(debugLabel, "subjectLift interaction.subjects count=\(subjects.count)")
        }

        guard !subjects.isEmpty else {
            throw NSError(domain: "NativeVision", code: 404, userInfo: [
                NSLocalizedDescriptionKey: "这个候选框没有可抠出的主体"
            ])
        }

        if let debugLabel {
            nativeVisionDebugLog(debugLabel, "subjectLift interaction.image begin subjects=\(subjects.count)")
        }
        let cutout = try await interaction.image(for: subjects)
        if let debugLabel {
            nativeVisionDebugLog(debugLabel, "subjectLift interaction.image end size=\(Int(cutout.size.width))x\(Int(cutout.size.height))")
        }
        guard let data = cutout.pngData() else {
            throw NSError(domain: "NativeVision", code: 500, userInfo: [
                NSLocalizedDescriptionKey: "主体图片导出失败"
            ])
        }
        if let debugLabel {
            nativeVisionDebugLog(debugLabel, "subjectLift pngData end bytes=\(data.count)")
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

            let rawSubjects = await interaction.subjects
            guard !rawSubjects.isEmpty else { return [] }

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

private struct NativeCameraClassification {
    let identifier: String
    let localizedName: String
    let confidence: Double
}

private struct NativeCameraStickerItem {
    var id: String
    var name: String
    var nativeCategory: String?
    var categoryConfidence: Double?
    var rect: CGRect
    var confidence: Double
    var source: String
    var imageData: Data
    var cutoutData: Data
    var expiry: String? = nil
    var rotation: Int = 0

    func asJSObject() -> [String: Any] {
        [
            "id": id,
            "name": name,
            "nativeCategory": nativeCategory as Any,
            "categoryConfidence": categoryConfidence as Any,
            "rect": rect.asJSObject(),
            "confidence": confidence,
            "source": source,
            "imageBase64": imageData.base64EncodedString(),
            "imageMimeType": "image/png",
            "cutoutBase64": cutoutData.base64EncodedString(),
            "cutoutMimeType": "image/png",
            "expiry": expiry as Any,
            "rotation": rotation
        ]
    }
}

private struct NativeCameraCapturePayload {
    let photoData: Data
    let width: Int
    let height: Int
    let items: [NativeCameraStickerItem]

    func asRecognizedJSObject() -> [String: Any] {
        [
            "photoBase64": photoData.base64EncodedString(),
            "photoMimeType": "image/jpeg",
            "width": width,
            "height": height,
            "items": items.map { $0.asJSObject() }
        ]
    }
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

private func aspectFillRect(imageSize: CGSize, boundingSize: CGSize) -> CGRect {
    guard imageSize.width > 0, imageSize.height > 0, boundingSize.width > 0, boundingSize.height > 0 else {
        return .zero
    }

    let scale = max(boundingSize.width / imageSize.width, boundingSize.height / imageSize.height)
    let width = imageSize.width * scale
    let height = imageSize.height * scale
    return CGRect(
        x: (boundingSize.width - width) / 2,
        y: (boundingSize.height - height) / 2,
        width: width,
        height: height
    )
}

private func cropImage(
    image: UIImage,
    normalizedRect: CGRect,
    maxSide: CGFloat,
    paddingRatio: CGFloat
) -> UIImage? {
    guard let cgImage = image.cgImage else { return nil }

    let imageWidth = CGFloat(cgImage.width)
    let imageHeight = CGFloat(cgImage.height)
    let clamped = normalizedRect.clampedUnit()
    var cropRect = CGRect(
        x: clamped.minX * imageWidth,
        y: clamped.minY * imageHeight,
        width: clamped.width * imageWidth,
        height: clamped.height * imageHeight
    )
    let padX = cropRect.width * paddingRatio
    let padY = cropRect.height * paddingRatio
    cropRect = cropRect
        .insetBy(dx: -padX, dy: -padY)
        .intersection(CGRect(x: 0, y: 0, width: imageWidth, height: imageHeight))
        .integral

    guard cropRect.width > 1,
          cropRect.height > 1,
          let cropped = cgImage.cropping(to: cropRect) else {
        return nil
    }
    let croppedImage = UIImage(cgImage: cropped, scale: 1, orientation: .up)
    return resizedImage(croppedImage, maxSide: maxSide)
}

private func resizedImage(_ image: UIImage, maxSide: CGFloat) -> UIImage? {
    let width = image.size.width
    let height = image.size.height
    guard width > 0, height > 0 else { return nil }
    let scale = min(1, maxSide / max(width, height))
    if scale >= 0.999 { return image }

    let targetSize = CGSize(width: max(1, width * scale), height: max(1, height * scale))
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    format.opaque = false
    return UIGraphicsImageRenderer(size: targetSize, format: format).image { _ in
        image.draw(in: CGRect(origin: .zero, size: targetSize))
    }
}

private func whiteAlphaImage(from image: UIImage) -> UIImage {
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    format.opaque = false
    let rect = CGRect(origin: .zero, size: image.size)
    return UIGraphicsImageRenderer(size: image.size, format: format).image { _ in
        UIColor.white.setFill()
        UIRectFill(rect)
        image.draw(in: rect, blendMode: .destinationIn, alpha: 1)
    }
}

private func addWhiteStickerOutlineData(_ cutoutData: Data) -> Data? {
    guard let image = UIImage(data: cutoutData) else { return nil }
    let maxImageSide = max(image.size.width, image.size.height)
    guard maxImageSide > 1 else { return cutoutData }

    let outline = max(14, Int((maxImageSide * 0.055).rounded()))
    let canvasSize = CGSize(
        width: image.size.width + CGFloat(outline * 2),
        height: image.size.height + CGFloat(outline * 2)
    )
    let imageRect = CGRect(
        x: CGFloat(outline),
        y: CGFloat(outline),
        width: image.size.width,
        height: image.size.height
    )
    let silhouette = whiteAlphaImage(from: image)
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    format.opaque = false
    let renderer = UIGraphicsImageRenderer(size: canvasSize, format: format)

    return renderer.pngData { _ in
        let radii = [
            CGFloat(outline),
            CGFloat(outline) * 0.72,
            CGFloat(outline) * 0.44,
            CGFloat(outline) * 0.22
        ]
        let steps = 36
        for radius in radii {
            for step in 0..<steps {
                let angle = CGFloat.pi * 2 * CGFloat(step) / CGFloat(steps)
                let rect = imageRect.offsetBy(
                    dx: cos(angle) * radius,
                    dy: sin(angle) * radius
                )
                silhouette.draw(in: rect, blendMode: .normal, alpha: 0.98)
            }
        }
        image.draw(in: imageRect)
    }
}

private func rotatePngDataClockwise(_ data: Data) -> Data? {
    guard let image = UIImage(data: data) else { return nil }
    let sourceSize = image.size
    guard sourceSize.width > 0, sourceSize.height > 0 else { return data }

    let targetSize = CGSize(width: sourceSize.height, height: sourceSize.width)
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    format.opaque = false
    return UIGraphicsImageRenderer(size: targetSize, format: format).pngData { context in
        let cgContext = context.cgContext
        cgContext.translateBy(x: targetSize.width / 2, y: targetSize.height / 2)
        cgContext.rotate(by: .pi / 2)
        image.draw(in: CGRect(
            x: -sourceSize.width / 2,
            y: -sourceSize.height / 2,
            width: sourceSize.width,
            height: sourceSize.height
        ))
    }
}

private func classifyNativeCategory(cgImage: CGImage) -> NativeCameraClassification? {
    let request = VNClassifyImageRequest()
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
    do {
        try handler.perform([request])
        guard let result = request.results?
            .filter({ !$0.identifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
            .sorted(by: { $0.confidence > $1.confidence })
            .first,
              result.confidence >= 0.08 else {
            return nil
        }
        let identifier = result.identifier
        return NativeCameraClassification(
            identifier: identifier,
            localizedName: localizedCategoryName(identifier),
            confidence: Double(result.confidence)
        )
    } catch {
        NSLog("[NativeVision] image classification failed: %@", error.localizedDescription)
        return nil
    }
}

private func localizedCategoryName(_ identifier: String) -> String {
    let normalized = identifier
        .replacingOccurrences(of: "_", with: " ")
        .replacingOccurrences(of: "-", with: " ")
        .lowercased()

    let keywordNames: [(String, String)] = [
        ("hair brush", "梳子"),
        ("hairbrush", "梳子"),
        ("comb", "梳子"),
        ("toothbrush", "牙刷"),
        ("brush", "刷子"),
        ("bottle", "瓶子"),
        ("water bottle", "水瓶"),
        ("cup", "杯子"),
        ("mug", "马克杯"),
        ("glass", "玻璃杯"),
        ("can", "罐装物"),
        ("jar", "罐子"),
        ("box", "盒子"),
        ("container", "收纳盒"),
        ("carton", "纸盒"),
        ("bag", "袋子"),
        ("book", "书"),
        ("notebook", "笔记本"),
        ("pen", "笔"),
        ("pencil", "铅笔"),
        ("scissors", "剪刀"),
        ("knife", "刀具"),
        ("spoon", "勺子"),
        ("fork", "叉子"),
        ("plate", "盘子"),
        ("bowl", "碗"),
        ("food", "食品"),
        ("snack", "零食"),
        ("fruit", "水果"),
        ("vegetable", "蔬菜"),
        ("bread", "面包"),
        ("cake", "蛋糕"),
        ("cookie", "饼干"),
        ("chocolate", "巧克力"),
        ("candy", "糖果"),
        ("milk", "牛奶"),
        ("drink", "饮料"),
        ("beverage", "饮料"),
        ("medicine", "药品"),
        ("pill", "药品"),
        ("cosmetic", "化妆品"),
        ("makeup", "化妆品"),
        ("lotion", "护肤品"),
        ("cream", "护肤品"),
        ("shampoo", "洗发水"),
        ("soap", "清洁用品"),
        ("detergent", "清洁用品"),
        ("remote", "遥控器"),
        ("phone", "手机"),
        ("camera", "相机"),
        ("charger", "充电器"),
        ("cable", "线缆"),
        ("shoe", "鞋"),
        ("clothing", "衣物"),
        ("toy", "玩具"),
        ("tool", "工具"),
        ("hardware", "五金工具")
    ]

    if let match = keywordNames.first(where: { normalized.contains($0.0) }) {
        return match.1
    }

    let cleaned = identifier
        .replacingOccurrences(of: "_", with: " ")
        .replacingOccurrences(of: "-", with: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    return cleaned.isEmpty ? "物品" : cleaned
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

private final class NativeAutoCameraViewController: UIViewController, AVCapturePhotoCaptureDelegate, UITextFieldDelegate {
    var onCapture: ((Result<NativeCameraCapturePayload, Error>) -> Void)?
    var onCapturedImage: ((UIImage) async -> Void)?
    var onCancel: (() -> Void)?
    var showsRecognitionAnimation = false

    private let session = AVCaptureSession()
    private let output = AVCapturePhotoOutput()
    private let sessionQueue = DispatchQueue(label: "home-inventory.native-camera.session")
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var didFinish = false
    private var capturedImage: UIImage?
    private var frozenImageView: UIImageView?
    private var markerLayers: [CAShapeLayer] = []
    private var itemImageViews: [String: UIImageView] = [:]
    private var progressFillWidthConstraint: NSLayoutConstraint?
    private var reviewPhotoData: Data?
    private var reviewPhotoWidth = 0
    private var reviewPhotoHeight = 0
    private var reviewSessionId: String?
    private var reviewItems: [NativeCameraStickerItem] = []
    private var activeReviewIndex = 0
    private var reviewViewBuilt = false
    private var pendingRecognizedLabels: [String: (name: String?, category: String?)] = [:]

    private let reviewRootView: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        view.backgroundColor = UIColor(red: 0.955, green: 0.952, blue: 0.948, alpha: 1)
        view.alpha = 0
        return view
    }()

    private let reviewCloseButton: UIButton = {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setTitle("×", for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 30, weight: .regular)
        button.tintColor = UIColor(red: 0.13, green: 0.2, blue: 0.28, alpha: 1)
        button.backgroundColor = UIColor.white.withAlphaComponent(0.82)
        button.layer.cornerRadius = 22
        button.layer.cornerCurve = .continuous
        return button
    }()

    private let reviewContentStack: UIStackView = {
        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 18
        return stack
    }()

    private let reviewStageView: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        view.clipsToBounds = false
        return view
    }()

    private let reviewObjectFrameView: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        view.clipsToBounds = false
        view.layer.shadowColor = UIColor.black.cgColor
        view.layer.shadowOpacity = 0.14
        view.layer.shadowRadius = 26
        view.layer.shadowOffset = CGSize(width: 0, height: 15)
        return view
    }()

    private let reviewCutoutImageView: UIImageView = {
        let imageView = UIImageView()
        imageView.translatesAutoresizingMaskIntoConstraints = false
        imageView.contentMode = .scaleAspectFit
        imageView.clipsToBounds = false
        imageView.alpha = 0
        return imageView
    }()

    private let reviewStickerImageView: UIImageView = {
        let imageView = UIImageView()
        imageView.translatesAutoresizingMaskIntoConstraints = false
        imageView.contentMode = .scaleAspectFit
        imageView.clipsToBounds = false
        imageView.alpha = 0
        return imageView
    }()

    private let reviewNameField: UITextField = {
        let field = UITextField()
        field.translatesAutoresizingMaskIntoConstraints = false
        field.textAlignment = .center
        field.textColor = UIColor(red: 0.12, green: 0.2, blue: 0.29, alpha: 1)
        field.tintColor = UIColor(red: 0.86, green: 0.53, blue: 0.22, alpha: 1)
        field.font = .systemFont(ofSize: 44, weight: .heavy)
        field.adjustsFontSizeToFitWidth = true
        field.minimumFontSize = 24
        field.returnKeyType = .done
        field.clearButtonMode = .whileEditing
        field.autocorrectionType = .no
        field.backgroundColor = .clear
        return field
    }()

    private let reviewCategoryLabel: UILabel = {
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.textAlignment = .center
        label.numberOfLines = 2
        label.font = .systemFont(ofSize: 17, weight: .semibold)
        label.textColor = UIColor(red: 0.46, green: 0.49, blue: 0.54, alpha: 1)
        return label
    }()

    private let reviewToolsStack: UIStackView = {
        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .horizontal
        stack.alignment = .center
        stack.distribution = .equalCentering
        stack.spacing = 12
        return stack
    }()

    private let reviewRotateButton: UIButton = {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setTitle("↻ 旋转方向", for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        button.tintColor = UIColor(red: 0.13, green: 0.2, blue: 0.28, alpha: 1)
        button.backgroundColor = .white
        button.layer.cornerRadius = 18
        button.layer.cornerCurve = .continuous
        button.contentEdgeInsets = UIEdgeInsets(top: 10, left: 16, bottom: 10, right: 16)
        return button
    }()

    private let reviewCounterLabel: UILabel = {
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.font = .monospacedDigitSystemFont(ofSize: 14, weight: .semibold)
        label.textColor = UIColor(red: 0.42, green: 0.45, blue: 0.5, alpha: 1)
        return label
    }()

    private let reviewExpiryField: UITextField = {
        let field = UITextField()
        field.translatesAutoresizingMaskIntoConstraints = false
        field.textAlignment = .center
        field.placeholder = "选择保质期"
        field.textColor = UIColor(red: 0.13, green: 0.2, blue: 0.28, alpha: 1)
        field.tintColor = UIColor(red: 0.86, green: 0.53, blue: 0.22, alpha: 1)
        field.font = .systemFont(ofSize: 16, weight: .semibold)
        field.backgroundColor = .white
        field.layer.cornerRadius = 20
        field.layer.cornerCurve = .continuous
        return field
    }()

    private let reviewThumbScrollView: UIScrollView = {
        let scrollView = UIScrollView()
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.alwaysBounceHorizontal = true
        return scrollView
    }()

    private let reviewThumbStack: UIStackView = {
        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .horizontal
        stack.alignment = .center
        stack.spacing = 10
        return stack
    }()

    private let reviewFooterView: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        return view
    }()

    private let reviewSaveButton: UIButton = {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setTitle("放入收集箱", for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 24, weight: .heavy)
        button.tintColor = UIColor(red: 0.86, green: 0.53, blue: 0.22, alpha: 1)
        button.backgroundColor = .white
        button.layer.cornerRadius = 34
        button.layer.cornerCurve = .continuous
        button.layer.shadowColor = UIColor.black.cgColor
        button.layer.shadowOpacity = 0.08
        button.layer.shadowRadius = 24
        button.layer.shadowOffset = CGSize(width: 0, height: 12)
        return button
    }()

    private lazy var reviewExpiryPicker: UIDatePicker = {
        let picker = UIDatePicker()
        picker.datePickerMode = .date
        if #available(iOS 13.4, *) {
            picker.preferredDatePickerStyle = .wheels
        }
        picker.addTarget(self, action: #selector(reviewExpiryPicked), for: .valueChanged)
        return picker
    }()

    private lazy var reviewDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private let whiteBackdropView: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        view.backgroundColor = UIColor(red: 0.98, green: 0.965, blue: 0.93, alpha: 1)
        view.alpha = 0
        return view
    }()

    private let markerOverlayView: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = false
        view.alpha = 0
        return view
    }()

    private let statusPill: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        view.backgroundColor = UIColor.black.withAlphaComponent(0.58)
        view.layer.cornerRadius = 18
        view.layer.cornerCurve = .continuous
        view.alpha = 0
        return view
    }()

    private let statusTitleLabel: UILabel = {
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.font = .systemFont(ofSize: 15, weight: .semibold)
        label.textColor = .white
        label.textAlignment = .center
        return label
    }()

    private let statusDetailLabel: UILabel = {
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.font = .systemFont(ofSize: 12, weight: .medium)
        label.textColor = UIColor.white.withAlphaComponent(0.72)
        label.textAlignment = .center
        return label
    }()

    private let progressTrackView: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        view.backgroundColor = UIColor.white.withAlphaComponent(0.22)
        view.layer.cornerRadius = 2
        return view
    }()

    private let progressFillView: UIView = {
        let view = UIView()
        view.translatesAutoresizingMaskIntoConstraints = false
        view.backgroundColor = .white
        view.layer.cornerRadius = 2
        return view
    }()

    private let shutterButton: UIButton = {
        let button = UIButton(type: .custom)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.backgroundColor = .white
        button.layer.cornerRadius = 34
        button.layer.borderWidth = 5
        button.layer.borderColor = UIColor(white: 1, alpha: 0.55).cgColor
        button.layer.shadowColor = UIColor.black.cgColor
        button.layer.shadowOpacity = 0.22
        button.layer.shadowRadius = 18
        button.layer.shadowOffset = CGSize(width: 0, height: 8)
        button.isEnabled = false
        return button
    }()

    private let closeButton: UIButton = {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setTitle("×", for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 32, weight: .regular)
        button.tintColor = .white
        button.backgroundColor = UIColor.black.withAlphaComponent(0.42)
        button.layer.cornerRadius = 22
        return button
    }()

    override var prefersStatusBarHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(layer)
        previewLayer = layer

        view.addSubview(whiteBackdropView)
        view.addSubview(markerOverlayView)
        view.addSubview(statusPill)
        statusPill.addSubview(statusTitleLabel)
        statusPill.addSubview(statusDetailLabel)
        statusPill.addSubview(progressTrackView)
        progressTrackView.addSubview(progressFillView)
        view.addSubview(closeButton)
        view.addSubview(shutterButton)
        closeButton.addTarget(self, action: #selector(cancel), for: .touchUpInside)
        shutterButton.addTarget(self, action: #selector(capture), for: .touchUpInside)

        progressFillWidthConstraint = progressFillView.widthAnchor.constraint(equalToConstant: 0)
        progressFillWidthConstraint?.isActive = true
        NSLayoutConstraint.activate([
            whiteBackdropView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            whiteBackdropView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            whiteBackdropView.topAnchor.constraint(equalTo: view.topAnchor),
            whiteBackdropView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            markerOverlayView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            markerOverlayView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            markerOverlayView.topAnchor.constraint(equalTo: view.topAnchor),
            markerOverlayView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            statusPill.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            statusPill.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 18),
            statusPill.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -44),
            statusPill.widthAnchor.constraint(greaterThanOrEqualToConstant: 214),

            statusTitleLabel.leadingAnchor.constraint(equalTo: statusPill.leadingAnchor, constant: 18),
            statusTitleLabel.trailingAnchor.constraint(equalTo: statusPill.trailingAnchor, constant: -18),
            statusTitleLabel.topAnchor.constraint(equalTo: statusPill.topAnchor, constant: 12),

            statusDetailLabel.leadingAnchor.constraint(equalTo: statusPill.leadingAnchor, constant: 18),
            statusDetailLabel.trailingAnchor.constraint(equalTo: statusPill.trailingAnchor, constant: -18),
            statusDetailLabel.topAnchor.constraint(equalTo: statusTitleLabel.bottomAnchor, constant: 2),

            progressTrackView.leadingAnchor.constraint(equalTo: statusPill.leadingAnchor, constant: 18),
            progressTrackView.trailingAnchor.constraint(equalTo: statusPill.trailingAnchor, constant: -18),
            progressTrackView.topAnchor.constraint(equalTo: statusDetailLabel.bottomAnchor, constant: 9),
            progressTrackView.heightAnchor.constraint(equalToConstant: 4),
            progressTrackView.bottomAnchor.constraint(equalTo: statusPill.bottomAnchor, constant: -13),

            progressFillView.leadingAnchor.constraint(equalTo: progressTrackView.leadingAnchor),
            progressFillView.topAnchor.constraint(equalTo: progressTrackView.topAnchor),
            progressFillView.bottomAnchor.constraint(equalTo: progressTrackView.bottomAnchor),

            closeButton.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 18),
            closeButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            closeButton.widthAnchor.constraint(equalToConstant: 44),
            closeButton.heightAnchor.constraint(equalToConstant: 44),

            shutterButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            shutterButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -26),
            shutterButton.widthAnchor.constraint(equalToConstant: 68),
            shutterButton.heightAnchor.constraint(equalToConstant: 68)
        ])

        configureSession()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
        frozenImageView?.frame = view.bounds
        markerOverlayView.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sessionQueue.async { [session] in
            if session.isRunning {
                session.stopRunning()
            }
        }
    }

    private func configureSession() {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            do {
                self.session.beginConfiguration()
                self.session.sessionPreset = .photo

                guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
                    throw NSError(domain: "NativeVision", code: 601, userInfo: [
                        NSLocalizedDescriptionKey: "没有找到后置相机"
                    ])
                }
                let input = try AVCaptureDeviceInput(device: device)
                guard self.session.canAddInput(input), self.session.canAddOutput(self.output) else {
                    throw NSError(domain: "NativeVision", code: 602, userInfo: [
                        NSLocalizedDescriptionKey: "相机输入输出不可用"
                    ])
                }
                self.session.addInput(input)
                self.session.addOutput(self.output)
                if #available(iOS 13.0, *) {
                    self.output.maxPhotoQualityPrioritization = .quality
                }
                self.session.commitConfiguration()
                self.session.startRunning()

                DispatchQueue.main.async {
                    self.shutterButton.isEnabled = true
                    self.shutterButton.alpha = 1
                }
            } catch {
                DispatchQueue.main.async {
                    self.finish(.failure(error))
                }
            }
        }
    }

    @objc private func capture() {
        shutterButton.isEnabled = false
        shutterButton.alpha = 0.72
        if let connection = output.connection(with: .video), connection.isVideoOrientationSupported {
            connection.videoOrientation = .portrait
        }
        let settings = AVCapturePhotoSettings()
        if #available(iOS 13.0, *) {
            settings.photoQualityPrioritization = .quality
        }
        output.capturePhoto(with: settings, delegate: self)
    }

    @objc private func cancel() {
        guard !didFinish else { return }
        didFinish = true
        dismiss(animated: true) { [onCancel] in
            onCancel?()
        }
    }

    private func showCapturedImage(_ image: UIImage) {
        capturedImage = image
        shutterButton.isHidden = true
        closeButton.isHidden = true

        let frozen: UIImageView
        if let existing = frozenImageView {
            frozen = existing
        } else {
            frozen = UIImageView(frame: view.bounds)
            frozen.contentMode = .scaleAspectFill
            frozen.clipsToBounds = true
            frozen.backgroundColor = .black
            frozenImageView = frozen
            view.insertSubview(frozen, aboveSubview: whiteBackdropView)
        }
        frozen.image = image
        frozen.frame = view.bounds
        frozen.alpha = 1

        view.bringSubviewToFront(markerOverlayView)
        view.bringSubviewToFront(statusPill)
        view.bringSubviewToFront(closeButton)
        view.bringSubviewToFront(shutterButton)

        updateStatus(title: "正在识别物品", detail: "照片已捕获，保持当前画面")
        updateProgress(0.08, animated: false)
    }

    func updateStatus(title: String, detail: String) {
        statusTitleLabel.text = title
        statusDetailLabel.text = detail
        view.bringSubviewToFront(statusPill)
        if statusPill.alpha < 1 {
            UIView.animate(withDuration: 0.22) {
                self.statusPill.alpha = 1
            }
        }
    }

    private func frameForImageRect(_ rect: CGRect, imageSize: CGSize) -> CGRect {
        let imageFrame = aspectFillRect(imageSize: imageSize, boundingSize: view.bounds.size)
        return CGRect(
            x: imageFrame.minX + rect.minX * imageFrame.width,
            y: imageFrame.minY + rect.minY * imageFrame.height,
            width: rect.width * imageFrame.width,
            height: rect.height * imageFrame.height
        )
    }

    func showDetectionMarkers(_ rects: [CGRect], imageSize: CGSize) {
        markerLayers.forEach { $0.removeFromSuperlayer() }
        markerLayers = []
        markerOverlayView.frame = view.bounds

        for (index, rect) in rects.enumerated() {
            let frame = frameForImageRect(rect, imageSize: imageSize).insetBy(dx: -6, dy: -6)
            let layer = CAShapeLayer()
            layer.path = UIBezierPath(roundedRect: frame, cornerRadius: 18).cgPath
            layer.fillColor = UIColor.white.withAlphaComponent(0.05).cgColor
            layer.strokeColor = UIColor.white.withAlphaComponent(0.86).cgColor
            layer.lineWidth = 2.5
            layer.lineDashPattern = [8, 7]
            layer.opacity = 0
            markerOverlayView.layer.addSublayer(layer)
            markerLayers.append(layer)

            let fade = CABasicAnimation(keyPath: "opacity")
            fade.fromValue = 0
            fade.toValue = 1
            fade.duration = 0.2
            fade.beginTime = CACurrentMediaTime() + Double(index) * 0.045
            fade.fillMode = .forwards
            fade.isRemovedOnCompletion = false
            layer.add(fade, forKey: "fade")

            let stroke = CABasicAnimation(keyPath: "strokeEnd")
            stroke.fromValue = 0
            stroke.toValue = 1
            stroke.duration = 0.48
            stroke.beginTime = fade.beginTime
            stroke.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            layer.add(stroke, forKey: "stroke")
        }

        markerOverlayView.alpha = 1
        updateProgress(0.18, animated: true)
        UIView.animate(withDuration: 0.34, delay: 0.76, options: [.curveEaseInOut]) {
            self.markerOverlayView.alpha = 0
        }
    }

    func showCutout(
        id: String,
        image: UIImage,
        rect: CGRect,
        imageSize: CGSize,
        index: Int,
        total: Int
    ) {
        let baseFrame = frameForImageRect(rect, imageSize: imageSize)
        let liftFrame = baseFrame.insetBy(dx: -baseFrame.width * 0.1, dy: -baseFrame.height * 0.1)
        let imageView: UIImageView
        if let existing = itemImageViews[id] {
            imageView = existing
        } else {
            imageView = UIImageView(frame: liftFrame)
            imageView.contentMode = .scaleAspectFit
            imageView.clipsToBounds = false
            imageView.layer.shadowColor = UIColor.black.cgColor
            imageView.layer.shadowOpacity = 0.18
            imageView.layer.shadowRadius = 22
            imageView.layer.shadowOffset = CGSize(width: 0, height: 12)
            imageView.alpha = 0
            imageView.transform = CGAffineTransform(scaleX: 0.94, y: 0.94)
            itemImageViews[id] = imageView
            view.addSubview(imageView)
        }

        imageView.image = image
        imageView.frame = liftFrame
        view.bringSubviewToFront(imageView)
        view.bringSubviewToFront(statusPill)

        let progress = 0.24 + 0.5 * CGFloat(index) / CGFloat(max(1, total))
        updateProgress(progress, animated: true)
        UIView.animate(withDuration: 0.42, delay: Double(index) * 0.04, options: [.curveEaseOut]) {
            self.whiteBackdropView.alpha = 1
            self.frozenImageView?.alpha = 0.24
            imageView.alpha = 1
            imageView.transform = .identity
        }
    }

    func showSticker(id: String, image: UIImage, index: Int, total: Int) {
        guard let imageView = itemImageViews[id] else { return }
        UIView.transition(with: imageView, duration: 0.22, options: [.transitionCrossDissolve]) {
            imageView.image = image
        }
        UIView.animate(withDuration: 0.16, delay: 0, options: [.curveEaseOut]) {
            imageView.transform = CGAffineTransform(scaleX: 1.045, y: 1.045)
        } completion: { _ in
            UIView.animate(withDuration: 0.22, delay: 0, options: [.curveEaseOut]) {
                imageView.transform = .identity
            }
        }

        let progress = 0.34 + 0.56 * CGFloat(index + 1) / CGFloat(max(1, total))
        updateProgress(progress, animated: true)
    }

    func showCompletion(count: Int) {
        updateStatus(title: "贴纸已生成", detail: "\(count) 件物品已自动描边")
        updateProgress(1, animated: true)
        UIView.animate(withDuration: 0.28, delay: 0, options: [.curveEaseOut]) {
            self.frozenImageView?.alpha = 0
            self.statusPill.backgroundColor = UIColor(red: 0.19, green: 0.47, blue: 0.38, alpha: 0.82)
        }
    }

    func beginRecognizedItemLabeling(sessionId: String) {
        reviewSessionId = sessionId
        pendingRecognizedLabels = [:]
    }

    func applyRecognizedItemLabels(sessionId: String, labels: [[String: Any]]) {
        guard reviewSessionId == sessionId else { return }
        var changed = false
        for label in labels {
            guard let id = (label["id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !id.isEmpty else {
                continue
            }
            let name = (label["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let category = (label["category"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            pendingRecognizedLabels[id] = (
                name: name?.isEmpty == false ? name : nil,
                category: category?.isEmpty == false ? category : nil
            )
            if let index = reviewItems.firstIndex(where: { $0.id == id }) {
                changed = applyRecognizedLabel(to: index, name: name, category: category) || changed
            }
        }
        if changed {
            refreshReviewUI(animatedOutline: false)
        }
    }

    @discardableResult
    private func applyRecognizedLabel(to index: Int, name: String?, category: String?) -> Bool {
        guard reviewItems.indices.contains(index) else { return false }
        var changed = false
        if let name, !name.isEmpty {
            let current = reviewItems[index].name.trimmingCharacters(in: .whitespacesAndNewlines)
            if current.isEmpty || current.range(of: #"^物品\s*\d+$"#, options: .regularExpression) != nil {
                reviewItems[index].name = name
                changed = true
            }
        }
        if let category, !category.isEmpty, reviewItems[index].nativeCategory != category {
            reviewItems[index].nativeCategory = category
            changed = true
        }
        return changed
    }

    private func applyPendingRecognizedLabels() {
        guard !pendingRecognizedLabels.isEmpty else { return }
        for index in reviewItems.indices {
            guard let label = pendingRecognizedLabels[reviewItems[index].id] else { continue }
            _ = applyRecognizedLabel(to: index, name: label.name, category: label.category)
        }
    }

    func presentNativeReview(sessionId: String, photoData: Data, width: Int, height: Int, items: [NativeCameraStickerItem]) {
        guard !didFinish else { return }
        reviewSessionId = sessionId
        reviewPhotoData = photoData
        reviewPhotoWidth = width
        reviewPhotoHeight = height
        reviewItems = items
        applyPendingRecognizedLabels()
        activeReviewIndex = 0
        setupNativeReviewViewIfNeeded()

        markerLayers.forEach { $0.removeFromSuperlayer() }
        markerLayers = []
        markerOverlayView.alpha = 0
        itemImageViews.values.forEach { $0.removeFromSuperview() }
        itemImageViews = [:]

        updateStatus(title: "编辑贴纸", detail: "描边会在编辑页中完成")
        updateProgress(1, animated: true)

        reviewRootView.transform = CGAffineTransform(translationX: 0, y: 26)
        reviewRootView.alpha = 0
        view.bringSubviewToFront(reviewRootView)
        refreshReviewUI(animatedOutline: true)

        UIView.animate(withDuration: 0.34, delay: 0.06, options: [.curveEaseOut]) {
            self.frozenImageView?.alpha = 0
            self.statusPill.alpha = 0
            self.reviewRootView.alpha = 1
            self.reviewRootView.transform = .identity
        }
    }

    private func setupNativeReviewViewIfNeeded() {
        guard !reviewViewBuilt else { return }
        reviewViewBuilt = true

        view.addSubview(reviewRootView)
        reviewRootView.addSubview(reviewCloseButton)
        reviewRootView.addSubview(reviewContentStack)
        reviewRootView.addSubview(reviewFooterView)
        reviewFooterView.addSubview(reviewSaveButton)

        reviewContentStack.addArrangedSubview(reviewStageView)
        reviewStageView.addSubview(reviewObjectFrameView)
        reviewObjectFrameView.addSubview(reviewCutoutImageView)
        reviewObjectFrameView.addSubview(reviewStickerImageView)
        reviewContentStack.addArrangedSubview(reviewNameField)
        reviewContentStack.addArrangedSubview(reviewCategoryLabel)
        reviewToolsStack.addArrangedSubview(reviewRotateButton)
        reviewToolsStack.addArrangedSubview(reviewCounterLabel)
        reviewContentStack.addArrangedSubview(reviewToolsStack)
        reviewContentStack.addArrangedSubview(reviewExpiryField)
        reviewContentStack.addArrangedSubview(reviewThumbScrollView)
        reviewThumbScrollView.addSubview(reviewThumbStack)

        reviewCloseButton.addTarget(self, action: #selector(cancel), for: .touchUpInside)
        reviewRotateButton.addTarget(self, action: #selector(rotateReviewItem), for: .touchUpInside)
        reviewSaveButton.addTarget(self, action: #selector(saveNativeReview), for: .touchUpInside)
        reviewNameField.delegate = self
        reviewExpiryField.delegate = self
        reviewExpiryField.inputView = reviewExpiryPicker
        reviewExpiryField.inputAccessoryView = makeReviewInputToolbar()

        let stageHeight = reviewStageView.heightAnchor.constraint(equalTo: reviewRootView.heightAnchor, multiplier: 0.34)
        stageHeight.priority = .defaultHigh
        let objectWidth = reviewObjectFrameView.widthAnchor.constraint(equalToConstant: 284)
        objectWidth.priority = .defaultHigh

        NSLayoutConstraint.activate([
            reviewRootView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            reviewRootView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            reviewRootView.topAnchor.constraint(equalTo: view.topAnchor),
            reviewRootView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            reviewCloseButton.trailingAnchor.constraint(equalTo: reviewRootView.safeAreaLayoutGuide.trailingAnchor, constant: -18),
            reviewCloseButton.topAnchor.constraint(equalTo: reviewRootView.safeAreaLayoutGuide.topAnchor, constant: 14),
            reviewCloseButton.widthAnchor.constraint(equalToConstant: 44),
            reviewCloseButton.heightAnchor.constraint(equalToConstant: 44),

            reviewFooterView.leadingAnchor.constraint(equalTo: reviewRootView.leadingAnchor),
            reviewFooterView.trailingAnchor.constraint(equalTo: reviewRootView.trailingAnchor),
            reviewFooterView.bottomAnchor.constraint(equalTo: reviewRootView.bottomAnchor),
            reviewFooterView.heightAnchor.constraint(equalToConstant: 118),

            reviewSaveButton.leadingAnchor.constraint(equalTo: reviewFooterView.leadingAnchor, constant: 34),
            reviewSaveButton.trailingAnchor.constraint(equalTo: reviewFooterView.trailingAnchor, constant: -34),
            reviewSaveButton.topAnchor.constraint(equalTo: reviewFooterView.topAnchor, constant: 12),
            reviewSaveButton.heightAnchor.constraint(equalToConstant: 76),

            reviewContentStack.leadingAnchor.constraint(equalTo: reviewRootView.leadingAnchor, constant: 24),
            reviewContentStack.trailingAnchor.constraint(equalTo: reviewRootView.trailingAnchor, constant: -24),
            reviewContentStack.topAnchor.constraint(equalTo: reviewRootView.safeAreaLayoutGuide.topAnchor, constant: 66),
            reviewContentStack.bottomAnchor.constraint(lessThanOrEqualTo: reviewFooterView.topAnchor, constant: -10),

            reviewStageView.widthAnchor.constraint(equalTo: reviewContentStack.widthAnchor),
            stageHeight,
            reviewStageView.heightAnchor.constraint(greaterThanOrEqualToConstant: 210),

            reviewObjectFrameView.centerXAnchor.constraint(equalTo: reviewStageView.centerXAnchor),
            reviewObjectFrameView.centerYAnchor.constraint(equalTo: reviewStageView.centerYAnchor),
            objectWidth,
            reviewObjectFrameView.widthAnchor.constraint(lessThanOrEqualTo: reviewStageView.widthAnchor, multiplier: 0.76),
            reviewObjectFrameView.heightAnchor.constraint(equalTo: reviewObjectFrameView.widthAnchor),

            reviewCutoutImageView.leadingAnchor.constraint(equalTo: reviewObjectFrameView.leadingAnchor),
            reviewCutoutImageView.trailingAnchor.constraint(equalTo: reviewObjectFrameView.trailingAnchor),
            reviewCutoutImageView.topAnchor.constraint(equalTo: reviewObjectFrameView.topAnchor),
            reviewCutoutImageView.bottomAnchor.constraint(equalTo: reviewObjectFrameView.bottomAnchor),

            reviewStickerImageView.leadingAnchor.constraint(equalTo: reviewObjectFrameView.leadingAnchor),
            reviewStickerImageView.trailingAnchor.constraint(equalTo: reviewObjectFrameView.trailingAnchor),
            reviewStickerImageView.topAnchor.constraint(equalTo: reviewObjectFrameView.topAnchor),
            reviewStickerImageView.bottomAnchor.constraint(equalTo: reviewObjectFrameView.bottomAnchor),

            reviewNameField.widthAnchor.constraint(equalTo: reviewContentStack.widthAnchor),
            reviewNameField.heightAnchor.constraint(equalToConstant: 58),

            reviewCategoryLabel.widthAnchor.constraint(equalTo: reviewContentStack.widthAnchor),

            reviewToolsStack.widthAnchor.constraint(lessThanOrEqualTo: reviewContentStack.widthAnchor, constant: -24),

            reviewExpiryField.widthAnchor.constraint(equalToConstant: 220),
            reviewExpiryField.heightAnchor.constraint(equalToConstant: 44),

            reviewThumbScrollView.widthAnchor.constraint(equalTo: reviewContentStack.widthAnchor),
            reviewThumbScrollView.heightAnchor.constraint(equalToConstant: 66),
            reviewThumbStack.leadingAnchor.constraint(equalTo: reviewThumbScrollView.contentLayoutGuide.leadingAnchor),
            reviewThumbStack.trailingAnchor.constraint(equalTo: reviewThumbScrollView.contentLayoutGuide.trailingAnchor),
            reviewThumbStack.topAnchor.constraint(equalTo: reviewThumbScrollView.contentLayoutGuide.topAnchor),
            reviewThumbStack.bottomAnchor.constraint(equalTo: reviewThumbScrollView.contentLayoutGuide.bottomAnchor),
            reviewThumbStack.heightAnchor.constraint(equalTo: reviewThumbScrollView.frameLayoutGuide.heightAnchor)
        ])
    }

    private func makeReviewInputToolbar() -> UIToolbar {
        let toolbar = UIToolbar()
        toolbar.sizeToFit()
        toolbar.items = [
            UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil),
            UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(dismissReviewKeyboard))
        ]
        return toolbar
    }

    private func refreshReviewUI(animatedOutline: Bool) {
        guard reviewItems.indices.contains(activeReviewIndex) else { return }
        let item = reviewItems[activeReviewIndex]
        reviewNameField.text = item.name
        reviewCounterLabel.text = "\(activeReviewIndex + 1)/\(reviewItems.count)"
        reviewCounterLabel.isHidden = reviewItems.count <= 1

        let rawCategory = (item.nativeCategory ?? "")
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        reviewCategoryLabel.text = rawCategory.isEmpty ? "AI 正在识别名称和分类…" : "分类：\(rawCategory)"

        let needsExpiry = itemNeedsExpiry(item)
        reviewExpiryField.isHidden = !needsExpiry
        reviewExpiryField.text = item.expiry ?? ""
        if let expiry = item.expiry, let date = reviewDateFormatter.date(from: expiry) {
            reviewExpiryPicker.date = date
        }

        reviewCutoutImageView.image = UIImage(data: item.cutoutData)
        reviewStickerImageView.image = UIImage(data: item.imageData)
        renderReviewThumbnails()

        if animatedOutline {
            reviewObjectFrameView.transform = CGAffineTransform(scaleX: 0.88, y: 0.88)
            reviewCutoutImageView.alpha = 1
            reviewStickerImageView.alpha = 0
            UIView.animate(withDuration: 0.34, delay: 0.08, options: [.curveEaseOut]) {
                self.reviewObjectFrameView.transform = .identity
            }
            UIView.animate(withDuration: 0.34, delay: 0.44, options: [.curveEaseInOut]) {
                self.reviewCutoutImageView.alpha = 0
                self.reviewStickerImageView.alpha = 1
            }
        } else {
            reviewObjectFrameView.transform = .identity
            reviewCutoutImageView.alpha = 0
            reviewStickerImageView.alpha = 1
        }
    }

    private func renderReviewThumbnails() {
        reviewThumbScrollView.isHidden = reviewItems.count <= 1
        reviewThumbStack.arrangedSubviews.forEach { subview in
            reviewThumbStack.removeArrangedSubview(subview)
            subview.removeFromSuperview()
        }

        for (index, item) in reviewItems.enumerated() {
            let button = UIButton(type: .custom)
            button.translatesAutoresizingMaskIntoConstraints = false
            button.tag = index
            button.backgroundColor = .white
            button.layer.cornerRadius = 17
            button.layer.cornerCurve = .continuous
            button.layer.borderWidth = index == activeReviewIndex ? 2 : 1
            button.layer.borderColor = (index == activeReviewIndex
                ? UIColor(red: 0.86, green: 0.53, blue: 0.22, alpha: 1)
                : UIColor(white: 0.86, alpha: 1)).cgColor
            button.imageView?.contentMode = .scaleAspectFit
            button.contentEdgeInsets = UIEdgeInsets(top: 7, left: 7, bottom: 7, right: 7)
            if let image = UIImage(data: item.imageData) {
                button.setImage(image.withRenderingMode(.alwaysOriginal), for: .normal)
            }
            button.addTarget(self, action: #selector(selectReviewThumb(_:)), for: .touchUpInside)
            NSLayoutConstraint.activate([
                button.widthAnchor.constraint(equalToConstant: 58),
                button.heightAnchor.constraint(equalToConstant: 58)
            ])
            reviewThumbStack.addArrangedSubview(button)
        }
    }

    private func commitActiveReviewEdits() {
        guard reviewItems.indices.contains(activeReviewIndex) else { return }
        let trimmedName = (reviewNameField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        reviewItems[activeReviewIndex].name = trimmedName.isEmpty ? "物品 \(activeReviewIndex + 1)" : trimmedName
        let trimmedExpiry = (reviewExpiryField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        reviewItems[activeReviewIndex].expiry = trimmedExpiry.isEmpty ? nil : trimmedExpiry
    }

    private func itemNeedsExpiry(_ item: NativeCameraStickerItem) -> Bool {
        let text = "\(item.name) \(item.nativeCategory ?? "")".lowercased()
        let keywords = [
            "食品", "零食", "水果", "蔬菜", "面包", "蛋糕", "饼干", "巧克力", "糖果", "牛奶", "饮料",
            "药", "药品", "护肤", "化妆", "洗发", "清洁", "food", "snack", "fruit", "vegetable",
            "bread", "cake", "cookie", "chocolate", "candy", "milk", "drink", "beverage", "medicine",
            "pill", "cosmetic", "makeup", "lotion", "cream", "shampoo", "soap", "detergent"
        ]
        return keywords.contains { text.contains($0.lowercased()) }
    }

    @objc private func rotateReviewItem() {
        commitActiveReviewEdits()
        guard reviewItems.indices.contains(activeReviewIndex) else { return }
        guard let rotatedSticker = rotatePngDataClockwise(reviewItems[activeReviewIndex].imageData),
              let rotatedCutout = rotatePngDataClockwise(reviewItems[activeReviewIndex].cutoutData) else {
            return
        }
        reviewItems[activeReviewIndex].imageData = rotatedSticker
        reviewItems[activeReviewIndex].cutoutData = rotatedCutout
        reviewItems[activeReviewIndex].rotation = (reviewItems[activeReviewIndex].rotation + 90) % 360
        refreshReviewUI(animatedOutline: false)
        reviewObjectFrameView.transform = CGAffineTransform(rotationAngle: -0.16).scaledBy(x: 0.92, y: 0.92)
        UIView.animate(withDuration: 0.28, delay: 0, options: [.curveEaseOut]) {
            self.reviewObjectFrameView.transform = .identity
        }
    }

    @objc private func selectReviewThumb(_ sender: UIButton) {
        guard reviewItems.indices.contains(sender.tag), sender.tag != activeReviewIndex else { return }
        commitActiveReviewEdits()
        activeReviewIndex = sender.tag
        view.endEditing(true)
        refreshReviewUI(animatedOutline: true)
    }

    @objc private func reviewExpiryPicked() {
        reviewExpiryField.text = reviewDateFormatter.string(from: reviewExpiryPicker.date)
    }

    @objc private func dismissReviewKeyboard() {
        view.endEditing(true)
    }

    @objc private func saveNativeReview() {
        commitActiveReviewEdits()
        guard let reviewPhotoData else {
            finish(.failure(NSError(domain: "NativeVision", code: 603, userInfo: [
                NSLocalizedDescriptionKey: "照片数据丢失"
            ])))
            return
        }
        reviewSaveButton.isEnabled = false
        reviewSaveButton.setTitle("保存中", for: .normal)
        finish(.success(NativeCameraCapturePayload(
            photoData: reviewPhotoData,
            width: reviewPhotoWidth,
            height: reviewPhotoHeight,
            items: reviewItems
        )))
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        return true
    }

    func showFailure(message: String) {
        updateStatus(title: "贴纸生成失败", detail: message)
        updateProgress(1, animated: true)
        UIView.animate(withDuration: 0.22) {
            self.statusPill.backgroundColor = UIColor(red: 0.65, green: 0.12, blue: 0.1, alpha: 0.82)
        }
    }

    private func updateProgress(_ value: CGFloat, animated: Bool) {
        statusPill.layoutIfNeeded()
        let width = max(1, progressTrackView.bounds.width)
        progressFillWidthConstraint?.constant = max(0, min(1, value)) * width
        let changes = {
            self.statusPill.layoutIfNeeded()
        }
        if animated {
            UIView.animate(withDuration: 0.24, delay: 0, options: [.curveEaseInOut], animations: changes)
        } else {
            changes()
        }
    }

    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        if let error {
            finish(.failure(error))
            return
        }
        guard let data = photo.fileDataRepresentation(),
              let image = UIImage(data: data),
              let normalized = normalizedImage(from: image) else {
            finish(.failure(NSError(domain: "NativeVision", code: 603, userInfo: [
                NSLocalizedDescriptionKey: "照片导出失败"
            ])))
            return
        }
        if let onCapturedImage {
            if showsRecognitionAnimation {
                showCapturedImage(normalized)
            } else {
                shutterButton.isHidden = true
                closeButton.isHidden = true
            }
            sessionQueue.async { [session] in
                if session.isRunning {
                    session.stopRunning()
                }
            }
            Task {
                await onCapturedImage(normalized)
            }
        } else if let jpeg = normalized.jpegData(compressionQuality: 0.92), let cgImage = normalized.cgImage {
            finish(.success(NativeCameraCapturePayload(
                photoData: jpeg,
                width: cgImage.width,
                height: cgImage.height,
                items: []
            )))
        } else {
            finish(.failure(NSError(domain: "NativeVision", code: 603, userInfo: [
                NSLocalizedDescriptionKey: "照片导出失败"
            ])))
        }
    }

    func finish(_ result: Result<NativeCameraCapturePayload, Error>) {
        DispatchQueue.main.async {
            guard !self.didFinish else { return }
            self.didFinish = true
            self.dismiss(animated: false) { [onCapture = self.onCapture] in
                onCapture?(result)
            }
        }
    }
}
