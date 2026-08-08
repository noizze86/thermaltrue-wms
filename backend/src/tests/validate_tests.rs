use crate::validate::{validate_string, validate_sku, validate_quantity};
use crate::validate::WhScope;

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

#[test]
fn wh_scope_all_admin() {
    let s = WhScope::All;
    assert!(s.is_all());
    assert!(s.is_allowed("wh-a"));
    assert!(s.filter_ids(None).is_none());
    assert_eq!(s.filter_ids(Some("wh-a")), Some(vec!["wh-a".to_string()]));
}

#[test]
fn wh_scope_restricted_allows_own() {
    let s = WhScope::Restricted(vec!["wh-a".to_string(), "wh-b".to_string()]);
    assert!(!s.is_all());
    assert!(s.is_allowed("wh-a"));
    assert!(s.is_allowed("wh-b"));
    assert!(!s.is_allowed("wh-c"));
    assert!(!s.is_allowed(""));
}

#[test]
fn wh_scope_restricted_no_request_uses_list() {
    let s = WhScope::Restricted(vec!["wh-a".to_string(), "wh-b".to_string()]);
    assert_eq!(s.filter_ids(None), Some(vec!["wh-a".to_string(), "wh-b".to_string()]));
}

#[test]
fn wh_scope_restricted_requested_intersect() {
    let s = WhScope::Restricted(vec!["wh-a".to_string(), "wh-b".to_string()]);
    assert_eq!(s.filter_ids(Some("wh-a")), Some(vec!["wh-a".to_string()]));
    assert_eq!(s.filter_ids(Some("wh-c")), Some(vec![]));
    assert_eq!(s.filter_ids(Some("")), Some(vec!["wh-a".to_string(), "wh-b".to_string()]));
}

#[test]
fn wh_scope_restricted_empty_list_no_rows() {
    let s = WhScope::Restricted(vec![]);
    assert_eq!(s.filter_ids(None), Some(vec![]));
    assert!(!s.is_allowed("wh-a"));
}
