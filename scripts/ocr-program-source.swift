// Local-only OCR for approved program sources. Requires macOS Vision/PDFKit.
import Foundation
import AppKit
import PDFKit
import Vision

struct Page: Codable {
    let pageNumber: Int?
    let text: String
    let meanConfidence: Float
}

func recognize(_ image: CGImage, pageNumber: Int?) throws -> Page {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["en-US"]
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: image).perform([request])
    let candidates = (request.results ?? []).compactMap { $0.topCandidates(1).first }
    let weight = candidates.reduce(0) { $0 + $1.string.count }
    let confidence = candidates.reduce(Float(0)) { $0 + $1.confidence * Float($1.string.count) } / Float(max(weight, 1))
    return Page(pageNumber: pageNumber, text: candidates.map(\.string).joined(separator: "\n"), meanConfidence: confidence)
}

guard CommandLine.arguments.count >= 2 else { fatalError("Expected source path and optional page list") }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let requested = CommandLine.arguments.count > 2 ? Set(CommandLine.arguments[2].split(separator: ",").compactMap { Int($0) }) : nil
var pages: [Page] = []
if url.pathExtension.lowercased() == "pdf", let document = PDFDocument(url: url) {
    guard document.pageCount <= 200 else { fatalError("Source exceeds 200-page OCR guard") }
    for index in 0..<document.pageCount {
        if let requested, !requested.contains(index + 1) { continue }
        try autoreleasepool {
            guard let page = document.page(at: index) else { return }
            let bounds = page.bounds(for: .mediaBox)
            let thumbnail = page.thumbnail(of: NSSize(width: bounds.width * 2.5, height: bounds.height * 2.5), for: .mediaBox)
            guard let image = thumbnail.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
            pages.append(try recognize(image, pageNumber: index + 1))
        }
    }
} else {
    guard let source = NSImage(contentsOf: url), let image = source.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fatalError("Unreadable source") }
    pages.append(try recognize(image, pageNumber: nil))
}
let data = try JSONEncoder().encode(pages)
FileHandle.standardOutput.write(data)
