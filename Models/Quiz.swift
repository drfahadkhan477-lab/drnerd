import Foundation

enum QuestionType: String, Codable {
    case multipleChoice
    case trueFalse
    case shortAnswer
}

struct Question: Identifiable, Codable {
    var id: UUID
    var questionText: String
    var type: QuestionType
    var options: [String]
    var correctAnswerIndex: Int
    var explanation: String
}

struct Quiz: Identifiable, Codable {
    var id: UUID
    var lessonId: UUID
    var title: String
    var description: String
    var questions: [Question]
    var passingScore: Double
    var timeLimit: Int // in seconds
    var createdAt: Date
}