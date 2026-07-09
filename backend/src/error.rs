use serde::ser::SerializeStruct;
use serde::Serialize;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug)]
pub enum AppError {
    Db(String),
    Auth(String),
    NotFound(String),
    Validation(String),
    Internal(String),
    Lock(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Db(msg) => write!(f, "Database error: {}", msg),
            AppError::Auth(msg) => write!(f, "Authentication error: {}", msg),
            AppError::NotFound(msg) => write!(f, "Not found: {}", msg),
            AppError::Validation(msg) => write!(f, "Validation error: {}", msg),
            AppError::Internal(msg) => write!(f, "Internal error: {}", msg),
            AppError::Lock(msg) => write!(f, "Lock error: {}", msg),
        }
    }
}

impl std::error::Error for AppError {}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        let (typ, msg) = match self {
            AppError::Db(m) => ("Db", m.as_str()),
            AppError::Auth(m) => ("Auth", m.as_str()),
            AppError::NotFound(m) => ("NotFound", m.as_str()),
            AppError::Validation(m) => ("Validation", m.as_str()),
            AppError::Internal(m) => ("Internal", m.as_str()),
            AppError::Lock(m) => ("Lock", m.as_str()),
        };
        state.serialize_field("type", typ)?;
        state.serialize_field("message", msg)?;
        state.end()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        match e {
            sqlx::Error::RowNotFound => AppError::NotFound(e.to_string()),
            _ => AppError::Db(e.to_string()),
        }
    }
}

impl From<sqlx::migrate::MigrateError> for AppError {
    fn from(e: sqlx::migrate::MigrateError) -> Self {
        AppError::Db(e.to_string())
    }
}

impl From<rust_xlsxwriter::XlsxError> for AppError {
    fn from(e: rust_xlsxwriter::XlsxError) -> Self {
        AppError::Internal(e.to_string())
    }
}

impl From<String> for AppError {
    fn from(e: String) -> Self {
        AppError::Internal(e)
    }
}
