use backend::db_pool::DbPool;
use backend::server::create_router;

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();

    let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
        eprintln!("WARN: DATABASE_URL not set, using default");
        "postgresql://postgres@localhost:5432/thermaltrue?sslmode=disable".into()
    });

    let pool = DbPool::new(&database_url).await.unwrap_or_else(|e| {
        eprintln!("FATAL: Cannot connect to database: {}", e);
        std::process::exit(1);
    });

    let app = create_router(pool);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3000".into());
    let addr = format!("0.0.0.0:{}", port);
    println!("API server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap_or_else(|e| {
        eprintln!("FATAL: Cannot bind to {}: {}", addr, e);
        std::process::exit(1);
    });

    axum::serve(listener, app).await.unwrap_or_else(|e| {
        eprintln!("FATAL: Server error: {}", e);
        std::process::exit(1);
    });
}
