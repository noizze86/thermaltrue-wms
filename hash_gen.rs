fn main() {
    let hash = bcrypt::hash("admin123", 12).unwrap();
    println!("{}", hash);
}
