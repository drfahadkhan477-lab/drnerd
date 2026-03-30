import Foundation

struct User: Identifiable, Codable {
    let id: String
    let name: String
    let email: String
    let photoURL: String?
    let enrolledCourses: [String]
    let completedCourses: [String]
    let createdAt: Date
    let updatedAt: Date
    
    init(id: String, name: String, email: String, photoURL: String? = nil) {
        self.id = id
        self.name = name
        self.email = email
        self.photoURL = photoURL
        self.enrolledCourses = []
        self.completedCourses = []
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}