import Firebase

class FirebaseService {
    // Initialize Firebase
    init() {
        FirebaseApp.configure()
    }

    // MARK: - User Operations
    func createUser(email: String, password: String, completion: @escaping (Error?) -> Void) {
        Auth.auth().createUser(withEmail: email, password: password) { authResult, error in
            completion(error)
        }
    }

    func getUser(userId: String, completion: @escaping (User?, Error?) -> Void) {
        // Implementation for fetching a user
    }

    func updateUser(userId: String, newData: [String: Any], completion: @escaping (Error?) -> Void) {
        // Implementation for updating user data
    }

    func deleteUser(userId: String, completion: @escaping (Error?) -> Void) {
        // Implementation for deleting a user
    }

    // MARK: - Course Operations
    func createCourse(courseData: [String: Any], completion: @escaping (Error?) -> Void) {
        let db = Firestore.firestore()
        db.collection("courses").addDocument(data: courseData) { error in
            completion(error)
        }
    }

    func getCourse(courseId: String, completion: @escaping (DocumentSnapshot?, Error?) -> Void) {
        let db = Firestore.firestore()
        db.collection("courses").document(courseId).getDocument { document, error in
            completion(document, error)
        }
    }

    func updateCourse(courseId: String, updatedData: [String: Any], completion: @escaping (Error?) -> Void) {
        let db = Firestore.firestore()
        db.collection("courses").document(courseId).updateData(updatedData) { error in
            completion(error)
        }
    }

    func deleteCourse(courseId: String, completion: @escaping (Error?) -> Void) {
        let db = Firestore.firestore()
        db.collection("courses").document(courseId).delete { error in
            completion(error)
        }
    }

    // MARK: - Progress Operations
    func updateProgress(userId: String, progressData: [String: Any], completion: @escaping (Error?) -> Void) {
        let db = Firestore.firestore()
        db.collection("progress").document(userId).setData(progressData, merge: true) { error in
            completion(error)
        }
    }

    // MARK: - Quiz Results Operations
    func createQuizResult(userId: String, quizData: [String: Any], completion: @escaping (Error?) -> Void) {
        let db = Firestore.firestore()
        db.collection("quizResults").document(userId).setData(quizData) { error in
            completion(error)
        }
    }

    func getQuizResult(userId: String, completion: @escaping (DocumentSnapshot?, Error?) -> Void) {
        let db = Firestore.firestore()
        db.collection("quizResults").document(userId).getDocument { document, error in
            completion(document, error)
        }
    }
}