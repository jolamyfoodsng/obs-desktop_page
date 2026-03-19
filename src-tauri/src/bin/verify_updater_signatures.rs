use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use walkdir::WalkDir;

fn main() {
    if let Err(error) = run() {
        eprintln!("[verify-updater-signatures] {}", error);
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = Args::parse(env::args().skip(1))?;
    let pubkey_path = args
        .pubkey
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("updater.pub.key"));
    let public_key_text = decode_tauri_wrapped_text(&pubkey_path)?;
    let public_key = PublicKey::decode(&public_key_text)
        .map_err(|error| format!("could not decode {}: {}", pubkey_path.display(), error))?;
    let public_key_id = parse_public_key_id(&public_key_text)?;

    println!(
        "[verify-updater-signatures] using updater public key {} from {}",
        public_key_id,
        pubkey_path.display()
    );

    let signature_paths = collect_signature_paths(&args.root)?;
    if signature_paths.is_empty() {
        return Err(format!(
            "no .sig files were found under {}",
            args.root.display()
        ));
    }

    for signature_path in signature_paths {
        let signed_asset_path = signed_asset_path(&signature_path)?;
        let signature_text = decode_tauri_wrapped_text(&signature_path)?;
        let signature = Signature::decode(&signature_text).map_err(|error| {
            format!(
                "could not decode signature {}: {}",
                signature_path.display(),
                error
            )
        })?;
        let signature_key_id = parse_signature_key_id(&signature_text)?;
        if signature_key_id != public_key_id {
            return Err(format!(
                "signature {} was created with updater key {}, but the app is configured for {}",
                signature_path.display(),
                signature_key_id,
                public_key_id
            ));
        }

        let asset_bytes = fs::read(&signed_asset_path).map_err(|error| {
            format!(
                "could not read signed asset {}: {}",
                signed_asset_path.display(),
                error
            )
        })?;
        public_key
            .verify(&asset_bytes, &signature, true)
            .map_err(|error| {
                format!(
                    "signature verification failed for {} using {}: {}",
                    signed_asset_path.display(),
                    signature_path.display(),
                    error
                )
            })?;

        println!(
            "[verify-updater-signatures] ok {} ({})",
            signed_asset_path.display(),
            signature_key_id
        );
    }

    Ok(())
}

struct Args {
    root: PathBuf,
    pubkey: Option<PathBuf>,
}

impl Args {
    fn parse<I>(mut args: I) -> Result<Self, String>
    where
        I: Iterator<Item = String>,
    {
        let mut root = None;
        let mut pubkey = None;

        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--root" => {
                    let value = args
                        .next()
                        .ok_or_else(|| "missing value for --root".to_string())?;
                    root = Some(PathBuf::from(value));
                }
                "--pubkey" => {
                    let value = args
                        .next()
                        .ok_or_else(|| "missing value for --pubkey".to_string())?;
                    pubkey = Some(PathBuf::from(value));
                }
                "--help" | "-h" => {
                    println!(
                        "Usage: cargo run --manifest-path src-tauri/Cargo.toml --bin verify_updater_signatures -- --root <bundle-dir> [--pubkey <path>]"
                    );
                    std::process::exit(0);
                }
                other => {
                    return Err(format!("unexpected argument: {}", other));
                }
            }
        }

        let root = root.ok_or_else(|| "missing required --root argument".to_string())?;
        Ok(Self { root, pubkey })
    }
}

fn collect_signature_paths(root: &Path) -> Result<Vec<PathBuf>, String> {
    if !root.exists() {
        return Err(format!(
            "bundle directory does not exist: {}",
            root.display()
        ));
    }

    let mut signature_paths = WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| entry.into_path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("sig"))
        .collect::<Vec<_>>();
    signature_paths.sort();
    Ok(signature_paths)
}

fn signed_asset_path(signature_path: &Path) -> Result<PathBuf, String> {
    let signature_name = signature_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("invalid signature filename: {}", signature_path.display()))?;
    let asset_name = signature_name.strip_suffix(".sig").ok_or_else(|| {
        format!(
            "signature file does not end with .sig: {}",
            signature_path.display()
        )
    })?;
    let asset_path = signature_path.with_file_name(asset_name);
    if !asset_path.exists() {
        return Err(format!(
            "signature {} does not have a matching asset {}",
            signature_path.display(),
            asset_path.display()
        ));
    }
    Ok(asset_path)
}

fn decode_tauri_wrapped_text(path: &Path) -> Result<String, String> {
    let encoded = fs::read_to_string(path)
        .map_err(|error| format!("could not read {}: {}", path.display(), error))?;
    let trimmed = encoded.trim();
    let decoded = STANDARD
        .decode(trimmed)
        .map_err(|error| format!("could not base64 decode {}: {}", path.display(), error))?;
    String::from_utf8(decoded)
        .map_err(|error| format!("could not parse {} as UTF-8: {}", path.display(), error))
}

fn parse_public_key_id(public_key_text: &str) -> Result<String, String> {
    let mut lines = public_key_text.lines();
    let _comment = lines
        .next()
        .ok_or_else(|| "updater public key is missing its comment line".to_string())?;
    let encoded_key = lines
        .next()
        .ok_or_else(|| "updater public key is missing its key data".to_string())?;
    let decoded_key = STANDARD
        .decode(encoded_key.trim())
        .map_err(|error| format!("could not decode updater public key data: {}", error))?;
    if decoded_key.len() != 42 {
        return Err("updater public key has an unexpected length".to_string());
    }
    Ok(hex_key_id(&decoded_key[2..10]))
}

fn parse_signature_key_id(signature_text: &str) -> Result<String, String> {
    let mut lines = signature_text.lines();
    let _comment = lines
        .next()
        .ok_or_else(|| "signature is missing its comment line".to_string())?;
    let encoded_signature = lines
        .next()
        .ok_or_else(|| "signature is missing its signature data".to_string())?;
    let decoded_signature = STANDARD
        .decode(encoded_signature.trim())
        .map_err(|error| format!("could not decode signature data: {}", error))?;
    if decoded_signature.len() != 74 {
        return Err("signature has an unexpected length".to_string());
    }
    Ok(hex_key_id(&decoded_signature[2..10]))
}

fn hex_key_id(raw_key_id: &[u8]) -> String {
    raw_key_id
        .iter()
        .rev()
        .map(|byte| format!("{:02X}", byte))
        .collect::<String>()
}
