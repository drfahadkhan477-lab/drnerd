import Foundation

struct Course: Identifiable, Codable {
    let id: String
    let title: String
    let description: String
    let instructor: String
    let thumbnail: String
    let category: String
    let rating: Double
    let price: Double
    let students: Int
    let lessons: [String]
    let createdAt: Date
    
    var formattedPrice: String {
        price == 0 ? "Free" : "$\(String(format: "%.2f", price))"
    }
}