use crate::validate::{validate_string, validate_sku, validate_quantity};

#[test]
fn validate_string_ok() {
    assert!(validate_string("hello", "Name", 255).is_ok());
}

#[test]
fn validate_string_empty() {
    let err = validate_string("", "Name", 255).unwrap_err();
    assert!(err.to_string().contains("cannot be empty"));
}

#[test]
fn validate_string_whitespace_only() {
    let err = validate_string("   ", "Name", 255).unwrap_err();
    assert!(err.to_string().contains("cannot be empty"));
}

#[test]
fn validate_string_too_long() {
    let long = "a".repeat(256);
    let err = validate_string(&long, "Name", 255).unwrap_err();
    assert!(err.to_string().contains("exceeds maximum length"));
}

#[test]
fn validate_string_exact_max() {
    let s = "a".repeat(255);
    assert!(validate_string(&s, "Name", 255).is_ok());
}

#[test]
fn validate_sku_ok() {
    assert!(validate_sku("MAT-001").is_ok());
    assert!(validate_sku("RAW_MATERIAL").is_ok());
}

#[test]
fn validate_sku_invalid_chars() {
    let err = validate_sku("hello world").unwrap_err();
    assert!(err.to_string().contains("can only contain"));
}

#[test]
fn validate_sku_empty() {
    let err = validate_sku("").unwrap_err();
    assert!(err.to_string().contains("cannot be empty"));
}

#[test]
fn validate_quantity_ok() {
    assert!(validate_quantity(0.0, "Qty").is_ok());
    assert!(validate_quantity(100.5, "Qty").is_ok());
}

#[test]
fn validate_quantity_negative() {
    let err = validate_quantity(-1.0, "Qty").unwrap_err();
    assert!(err.to_string().contains("cannot be negative"));
}
