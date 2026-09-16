fn main() {
    dotenv::dotenv().ok();

    if let Ok(payment_endpoint) = std::env::var("PAYMENT_ENDPOINT") {
        println!("cargo:rustc-env=PAYMENT_ENDPOINT={}", payment_endpoint);
    }

    if let Ok(api_access_key) = std::env::var("API_ACCESS_KEY") {
        println!("cargo:rustc-env=API_ACCESS_KEY={}", api_access_key);
    }

    if let Ok(app_endpoint) = std::env::var("APP_ENDPOINT") {
        println!("cargo:rustc-env=APP_ENDPOINT={}", app_endpoint);
    }

    // ChannelPulse OSS ships no telemetry: there is no POSTHOG_API_KEY passthrough.

    tauri_build::build()
}
