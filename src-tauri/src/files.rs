use std::path::Path;

// Cap how much we read from a single file so ingestion stays responsive and
// bounded in memory. PDFs can be larger than plain text, so allow some headroom.
const MAX_FILE_BYTES: u64 = 15 * 1024 * 1024;

// Extensions we treat as readable text/code/markdown. Binary formats (pdf,
// images, office docs) are rejected with a clear error.
const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "mdx", "text", "rtf", "log", "json", "jsonl", "yaml", "yml", "toml",
    "csv", "tsv", "xml", "html", "htm", "css", "scss", "js", "jsx", "ts", "tsx", "py", "rb", "go",
    "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cc", "cs", "php", "sh", "bash", "zsh",
    "sql", "env", "ini", "conf", "cfg", "gitignore", "dockerfile", "vue", "svelte", "r", "lua",
    "pl", "dart", "scala", "clj", "ex", "exs", "hs",
];

/// Read a user-selected local file as UTF-8 text (lossy). Used to ingest local
/// files into the semantic memory store. Rejects oversized or binary files.
#[tauri::command]
pub fn read_file_text(path: String) -> Result<String, String> {
    let p = Path::new(&path);

    if !p.exists() {
        return Err(format!("File does not exist: {}", path));
    }
    if !p.is_file() {
        return Err(format!("Not a file: {}", path));
    }

    let metadata = std::fs::metadata(p).map_err(|e| format!("Failed to stat file: {}", e))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err(format!(
            "File is too large ({} bytes). Max supported is {} bytes.",
            metadata.len(),
            MAX_FILE_BYTES
        ));
    }

    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());

    // PDFs are extracted to plain text via a dedicated parser.
    if ext.as_deref() == Some("pdf") {
        return pdf_extract::extract_text(p)
            .map_err(|e| format!("Failed to extract PDF text: {}", e));
    }

    // Allow known text extensions; also allow common extensionless files.
    let file_name = p
        .file_name()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let is_known_text = match &ext {
        Some(e) => TEXT_EXTENSIONS.contains(&e.as_str()),
        None => matches!(
            file_name.as_str(),
            "readme" | "license" | "dockerfile" | "makefile" | ".env"
        ),
    };
    if !is_known_text {
        return Err(format!(
            "Unsupported file type '{}'. Only plain-text, code, and markdown files are supported.",
            ext.unwrap_or_else(|| "unknown".to_string())
        ));
    }

    let bytes = std::fs::read(p).map_err(|e| format!("Failed to read file: {}", e))?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

/// Write raw bytes to a user-chosen path (e.g. system-design PNG download).
#[tauri::command]
pub fn write_file_bytes(path: String, contents: Vec<u8>) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!("Folder does not exist: {}", parent.display()));
        }
    }
    std::fs::write(p, contents).map_err(|e| format!("Failed to write file: {}", e))
}
